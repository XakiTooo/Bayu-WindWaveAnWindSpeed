import { readFileSync } from 'node:fs';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getDatabase, ServerValue } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import mqtt from 'mqtt';

const telemetryTopic = 'bayu/stations/+/telemetry';
const topicPattern = /^bayu\/stations\/([a-z0-9-]{1,64})\/telemetry$/;
const historyIntervalMs = 60_000;

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
  const { windSpeedKmh, windDirectionDeg } = data;
  if (!Number.isFinite(windSpeedKmh) || windSpeedKmh < 0 ||
      !Number.isFinite(windDirectionDeg) || windDirectionDeg < 0 ||
      windDirectionDeg >= 360) return null;

  return { stationId, windSpeedKmh, windDirectionDeg };
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
