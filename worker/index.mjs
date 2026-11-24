import { readFileSync } from 'node:fs';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getDatabase, ServerValue } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import mqtt from 'mqtt';

const telemetryTopic = 'bayu/stations/+/telemetry';
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

  if (!data || data.stationId !== stationId) return null;
  const { windSpeedKmh, windDirectionDeg, gps, lat, lon, lng, rssi, uptime_s, heap_kb, packet_id, is_muted, battery } = data;
  if (!Number.isFinite(windSpeedKmh) || windSpeedKmh < 0 ||
      !Number.isFinite(windDirectionDeg) || windDirectionDeg < 0 ||
      windDirectionDeg >= 360) return null;

  return {
    stationId,
    windSpeedKmh,
    windDirectionDeg,
    ...(gps ? { gps } : {}),
    ...(typeof lat === 'number' ? { lat } : {}),
    ...(typeof lon === 'number' ? { lon } : {}),
    ...(typeof lng === 'number' ? { lng } : {}),
    ...(Number.isFinite(rssi) ? { rssi } : {}),
    ...(Number.isFinite(uptime_s) ? { uptime_s } : {}),
    ...(Number.isFinite(heap_kb) ? { heap_kb } : {}),
    ...(Number.isFinite(packet_id) ? { packet_id } : {}),
    ...(typeof is_muted === 'boolean' ? { is_muted } : {}),
    ...(Number.isFinite(battery) && battery >= 0 && battery <= 100 ? { battery } : {}),
  };
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
  const telegramToken = process.env.BAYU_TELEGRAM_BOT_TOKEN;
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
    const reading = parseTelemetry(topic, payload);
    if (!reading) {
      console.warn('Pesan telemetri diabaikan karena formatnya tidak valid.');
      return;
    }

    const receivedAt = Date.now();
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
    const latestPath = `stations/${reading.stationId}/latest`;
    const latestWrite = database.ref(latestPath)
      .set({ ...reading, receivedAt: ServerValue.TIMESTAMP })
      .then(() => console.log(`Tersimpan ke /${latestPath}`))
      .catch((error) => console.error('Gagal menulis ke Realtime Database:', error.code ?? error.name));

    if (historyMinutes.get(reading.stationId) !== minute) {
      historyMinutes.set(reading.stationId, minute);
      const historyRef = firestore.doc(`stations/${reading.stationId}/readings/${minute}`);
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
