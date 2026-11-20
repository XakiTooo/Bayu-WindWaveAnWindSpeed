import { timingSafeEqual } from 'node:crypto';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import mqtt from 'mqtt';
import { getDatabase } from 'firebase-admin/database';
import { getDashboardAdminApp } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

const headers = {
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json',
};

function authorized(request) {
  const secret = process.env.BAYU_COMMAND_SECRET;
  const supplied = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!secret || secret === process.env.BAYU_TELEMETRY_SHARE_KEY || !supplied) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function publishCalibration(stationId) {
  const { MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD, MQTT_CA_FILE } = process.env;
  if (!MQTT_URL || !MQTT_USERNAME || !MQTT_PASSWORD || !MQTT_CA_FILE) {
    throw new Error('Konfigurasi MQTT perintah belum lengkap.');
  }
  const broker = new URL(MQTT_URL);
  if (broker.protocol !== 'mqtts:') throw new Error('Broker perintah harus memakai MQTT TLS.');
  const ca = readFileSync(MQTT_CA_FILE);
  const nonce = randomBytes(4).readUInt32BE() || 1;
  const ackTopic = `bayu/stations/${stationId}/ack`;

  return new Promise((resolve, reject) => {
    const client = mqtt.connect(broker.href, {
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
      ca,
      rejectUnauthorized: true,
      reconnectPeriod: 0,
      connectTimeout: 8000,
      clientId: `bayu-web-command-${randomUUID()}`,
    });
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('ESP tidak mengonfirmasi kalibrasi.')), 12000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.end(true);
      if (error) reject(error);
      else resolve();
    }
    client.on('error', finish);
    client.on('message', (topic, payload) => {
      if (topic !== ackTopic) return;
      try {
        const ack = JSON.parse(payload.toString('utf8'));
        if (ack.cmd === 'calibrate_zero' && ack.nonce === nonce && ack.status === 'applied') finish();
      } catch {}
    });
    client.on('connect', () => {
      client.subscribe(ackTopic, { qos: 1 }, (error) => {
        if (error) return finish(error);
        client.publish(`bayu/stations/${stationId}/cmd`, JSON.stringify({ cmd: 'calibrate_zero', nonce }),
          { qos: 1, retain: false }, (publishError) => { if (publishError) finish(publishError); });
      });
    });
  });
}

export async function POST(request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Kunci perintah tidak valid.' }, { status: 403, headers });
  }

  try {
    const { action, stationId: target = 'angin-01', payload = {} } = await request.json();
    if (typeof target !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(target)) {
      return Response.json({ error: 'ID stasiun tidak valid.' }, { status: 400, headers });
    }
    const stationId = target.toLowerCase();

    const validActions = ['calibrate_zero', 'buzzer_mute', 'buzzer_unmute', 'request_telemetry', 'reboot'];
    if (!validActions.includes(action)) {
      return Response.json({ error: `Perintah '${action}' tidak dikenali.` }, { status: 400, headers });
    }

    if (action === 'calibrate_zero') {
      try {
        await publishCalibration(stationId);
        return Response.json({ success: true, message: `ESP ${stationId} mengonfirmasi kalibrasi utara diterapkan.` }, { headers });
      } catch (error) {
        console.error('BAYU calibration publish failed:', error.code ?? error.name);
        const noAck = error.message === 'ESP tidak mengonfirmasi kalibrasi.';
        return Response.json({ error: noAck ? 'ESP belum mengonfirmasi kalibrasi. Upload firmware pengirim terbaru dan cek koneksi MQTT di Serial Monitor.' : 'Gagal mengirim kalibrasi ke broker MQTT. Periksa konfigurasi dan koneksi broker.' }, { status: noAck ? 504 : 503, headers });
      }
    }

    const commandEntry = {
      action,
      stationId,
      payload,
      createdAt: Date.now(),
      status: 'queued',
      source: 'web_dashboard',
    };

    // Attempt to queue command to Firebase Realtime Database
    try {
      const db = getDatabase(getDashboardAdminApp());
      await db.ref(`stations/${stationId}/commands`).push(commandEntry);
    } catch (fbErr) {
      console.error('BAYU command queue failed:', fbErr.code ?? fbErr.name);
      const hostname = new URL(request.url).hostname;
      if (!process.env.VERCEL && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
        try {
          const upstream = await fetch('https://bayu-windwave-and-windspeed.vercel.app/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: request.headers.get('authorization') },
            body: JSON.stringify({ action, stationId, payload }),
            signal: AbortSignal.timeout(10_000),
          });
          return Response.json(await upstream.json(), { status: upstream.status, headers });
        } catch (fwdErr) {
          console.error('BAYU command forwarding failed:', fwdErr.code ?? fwdErr.name);
        }
      }
      return Response.json({ error: 'Antrean perintah belum tersedia.' }, { status: 503, headers });
    }

    return Response.json({
      success: true,
      message: `Perintah [${action}] masuk antrean stasiun ${stationId}.`,
      command: commandEntry,
    }, { headers });
  } catch (error) {
    return Response.json({ error: 'Format permintaan tidak valid.' }, { status: 400, headers });
  }
}
