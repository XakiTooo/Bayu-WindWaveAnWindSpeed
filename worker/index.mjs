import { validReading } from '../src/lib/telemetry.mjs';
import { applyWebConfiguration } from '../src/lib/station-registry.mjs';
import { readFileSync } from 'node:fs';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getDatabase, ServerValue } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import mqtt from 'mqtt';

const localMode = process.env.BAYU_LOCAL_WORKER === '1';
const localStation = process.env.BAYU_LOCAL_STATION_ID;
const telemetryTopic = localMode && /^[a-z0-9-]{1,64}$/.test(localStation || '') ? `bayu/stations/${localStation}/telemetry` : 'bayu/stations/+/telemetry';
const topicPattern = /^bayu\/stations\/([a-z0-9-]{1,64})\/telemetry$/;
const historyIntervalMs = 60_000;
const alertCooldownMs = 10 * 60_000;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Isi ${name} di konfigurasi worker.`);
  return value;
}

function parseTelemetry(topic, payload) {
  const stationId = topicPattern.exec(topic)?.[1];
  if (!stationId || payload.length > 4096) return null;

  let data;
  try {
    data = JSON.parse(payload.toString('utf8'));
  } catch {
    return null;
  }

  const reading = validReading(stationId, { ...data, receivedAt: Date.now() });
  return reading ? { stationId, ...reading } : null;
}

function start() {
  const mqttUrl = new URL(required('MQTT_URL'));
  if (mqttUrl.protocol !== 'mqtts:') throw new Error('MQTT_URL harus menggunakan mqtts://.');

  const username = required('MQTT_USERNAME');
  const password = required('MQTT_PASSWORD');
  const ca = readFileSync(required('MQTT_CA_FILE'));
  const databaseURL = required('FIREBASE_DATABASE_URL');
  const app = initializeApp({ credential: applicationDefault(), databaseURL });
  const database = getDatabase(app);
  const firestore = getFirestore(app);
  const historyMinutes = new Map();
  const lastAlerts = new Map();
  const alertThreshold = Number(process.env.BAYU_ALERT_THRESHOLD_KMH);
  const telegramToken = localMode ? '' : process.env.BAYU_TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.BAYU_TELEGRAM_CHAT_ID;
  const client = mqtt.connect(mqttUrl.href, {
    username,
    password,
    ca,
    rejectUnauthorized: true,
    reconnectPeriod: 5000,
    resubscribe: false,
  });

  client.on('connect', () => {
    client.subscribe(telemetryTopic, { qos: 1 }, (error, granted) => {
      if (error || !granted?.length || granted.some(({ qos }) => qos >= 128)) {
        console.error('Broker menolak subscription telemetri.');
        return;
      }
      console.log(`MQTT terhubung. Mendengarkan ${telemetryTopic}`);
    });
  });
  client.on('error', (error) => {
    console.error('Koneksi MQTT gagal:', error.code ?? error.name);
  });
  client.on('message', async (topic, payload, packet) => {
    if (packet.retain) return;
    let reading = parseTelemetry(topic, payload);
    if (!reading) {
      console.warn('Pesan telemetri diabaikan karena formatnya tidak valid.');
      return;
    }

    const receivedAt = Date.now();
    try {
      const registry = (await firestore.doc(`stationRegistry/${reading.stationId}`).get()).data();
      if (registry?.deletedAt) return;
      if (reading.directionProcessing === 'server') {
        reading = applyWebConfiguration(reading, registry?.settings, registry?.directionCalibration);
      }
    } catch (error) {
      console.error('Registri stasiun belum tersedia:', error.code ?? error.name);
      return;
    }
    if (telegramToken && telegramChatId && Number.isFinite(alertThreshold) && alertThreshold > 0 &&
        reading.windSpeedKmh >= alertThreshold && receivedAt - (lastAlerts.get(reading.stationId) || 0) >= alertCooldownMs) {
      lastAlerts.set(reading.stationId, receivedAt);
      fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramChatId,
          text: `Peringatan BAYU: ${reading.stationId} ${reading.windSpeedKmh.toFixed(1)} km/jam (batas ${alertThreshold} km/jam).` }),
        signal: AbortSignal.timeout(8000),
      }).then((res) => { if (!res.ok) console.error('Telegram alert gagal:', res.status); })
        .catch((error) => console.error('Telegram alert gagal:', error.name));
    }
    const minute = Math.floor(receivedAt / historyIntervalMs);
    const latestPath = `stations/${reading.stationId}/${localMode ? 'processedLatest' : 'latest'}`;
    const latestWrite = database.ref(latestPath)
      .set({ ...reading, receivedAt: ServerValue.TIMESTAMP })
      .then(() => console.log(`Tersimpan ke /${latestPath}`))
      .catch((error) => console.error('Gagal menulis ke Realtime Database:', error.code ?? error.name));

    if (historyMinutes.get(reading.stationId) !== minute) {
      historyMinutes.set(reading.stationId, minute);
      const historyRef = firestore.doc(`stations/${reading.stationId}/${localMode ? 'processedReadings' : 'readings'}/${minute}`);
      try {
        await historyRef.create({ ...reading, receivedAt: new Date(receivedAt) });
        console.log(`Riwayat tersimpan ke /${historyRef.path}`);
      } catch (error) {
        // gRPC 6 means the sample already exists, including after a worker restart.
        if (error.code !== 6) {
          if (historyMinutes.get(reading.stationId) === minute) historyMinutes.delete(reading.stationId);
          console.error('Gagal menulis ke Firestore:', error.code ?? error.name);
        }
      }
    }
    await latestWrite;
    if (reading.directionProcessing === 'server') {
      client.publish(`bayu/stations/${reading.stationId}/processed`, JSON.stringify({ windDirectionDeg: reading.windDirectionDeg, receivedAt }),
        { qos: 1, retain: false }, (error) => { if (error) console.error('Koreksi arah gagal dikirim:', error.code ?? error.name); });
    }
  });

  const stop = () => {
    client.end(true, () => {
      deleteApp(app).catch(() => { process.exitCode = 1; });
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

try {
  start();
} catch (error) {
  console.error('Worker gagal mulai:', error.message);
  process.exitCode = 1;
}
