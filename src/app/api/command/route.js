import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import mqtt from 'mqtt';
import { sameOrigin } from '@/lib/admin-session.mjs';
import { currentUser } from '@/lib/auth-store.mjs';
import { getStation, canManageStation } from '@/lib/station-registry.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;

const headers = {
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json',
};

function publishCommand(stationId, action, station) {
  const { MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD, MQTT_CA_FILE, MQTT_CA_PEM } = process.env;
  if (!MQTT_URL || !MQTT_USERNAME || !MQTT_PASSWORD) {
    throw new Error('Konfigurasi MQTT perintah belum lengkap.');
  }
  const broker = new URL(MQTT_URL);
  if (broker.protocol !== 'mqtts:') throw new Error('Broker perintah harus memakai MQTT TLS.');
  const ca = MQTT_CA_PEM || (MQTT_CA_FILE ? readFileSync(MQTT_CA_FILE) : readFileSync(new URL('../../../../worker/emqxsl-ca.crt', import.meta.url)));
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
    const timeout = setTimeout(() => finish(new Error('ESP tidak mengonfirmasi perintah.')), 12000);
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
        if (ack.cmd === action && ack.nonce === nonce && ack.status === 'applied') finish();
      } catch {}
    });
    client.on('connect', () => {
      client.subscribe(ackTopic, { qos: 1 }, (error) => {
        if (error) return finish(error);
        const configuration = action === 'apply_settings';
        const topic = `bayu/stations/${stationId}/${configuration ? 'config' : 'cmd'}`;
        client.publish(topic, JSON.stringify({ cmd: action, nonce,
          ...(configuration ? { warningKmh: station.settings.warningKmh, dangerKmh: station.settings.dangerKmh, revision: station.updatedAt } : {}),
          ...(action === 'buzzer_mute' ? { is_muted: true } : action === 'buzzer_unmute' ? { is_muted: false } : {}) }),
          { qos: 1, retain: configuration }, (publishError) => { if (publishError) finish(publishError); });
      });
    });
  });
}

export async function POST(request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: 'Sesi admin tidak valid.' }, { status: 403, headers });
  }
  let user;
  try { user = await currentUser(request); } catch { return Response.json({ error: 'Database akun belum tersedia.' }, { status: 503, headers }); }
  if (!user) return Response.json({ error: 'Silakan masuk.' }, { status: 401, headers });

  try {
    const { action, stationId: target = 'angin-01' } = await request.json();
    if (typeof target !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(target)) {
      return Response.json({ error: 'ID stasiun tidak valid.' }, { status: 400, headers });
    }
    const stationId = target.toLowerCase();
    const station = await getStation(stationId);
    if (!canManageStation(user, station)) return Response.json({ error: 'Akses stasiun ditolak.' }, { status: 403, headers });

    const validActions = ['calibrate_zero', 'buzzer_mute', 'buzzer_unmute', 'request_telemetry', 'apply_settings'];
    if (!validActions.includes(action)) {
      return Response.json({ error: `Perintah '${action}' tidak dikenali.` }, { status: 400, headers });
    }

    try {
      if (action === 'apply_settings' && !station?.settings) return Response.json({ error: 'Daftarkan stasiun terlebih dahulu.' }, { status: 400, headers });
      await publishCommand(stationId, action, station);
      return Response.json({ success: true, message: `ESP ${stationId} mengonfirmasi ${action}.` }, { headers });
    } catch (error) {
      console.error('BAYU command failed:', error.code ?? error.name);
      const noAck = error.message === 'ESP tidak mengonfirmasi perintah.';
      return Response.json({ error: noAck ? 'ESP belum mengonfirmasi perintah. Periksa firmware dan koneksi MQTT.' : 'Gagal mengirim perintah ke broker MQTT.' }, { status: noAck ? 504 : 503, headers });
    }
  } catch (error) {
    return Response.json({ error: 'Format permintaan tidak valid.' }, { status: 400, headers });
  }
}
