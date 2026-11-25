import { runServerCalibration } from '@/lib/server-calibration.mjs';
import { calibrationPayload } from '@/lib/calibration-command.mjs';
import { recordCommandAck } from '@/lib/command-ack.mjs';
import { join } from 'node:path';
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

function publishCommand(stationId, action, station, calibration) {
  const { MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD, MQTT_CA_FILE, MQTT_CA_PEM } = process.env;
  if (!MQTT_URL || !MQTT_USERNAME || !MQTT_PASSWORD) {
    throw new Error('Konfigurasi MQTT perintah belum lengkap.');
  }
  const broker = new URL(MQTT_URL);
  if (broker.protocol !== 'mqtts:') throw new Error('Broker perintah harus memakai MQTT TLS.');
  const ca = MQTT_CA_PEM || (MQTT_CA_FILE ? readFileSync(MQTT_CA_FILE) : readFileSync(join(process.cwd(), 'worker', 'emqxsl-ca.crt')));
  const nonce = randomBytes(4).readUInt32BE() || 1;
  const ackTopic = `bayu/stations/${stationId}/ack`;

  const confirmedDevices = new Set();
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
    const timeout = setTimeout(() => finish(new Error('ESP tidak mengonfirmasi perintah.')), action === 'calibrate_four' ? 20000 : 12000);
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.end(true);
      if (error) reject(error);
      else resolve(result);
    }
    client.on('error', finish);
    client.on('message', (topic, payload) => {
      if (topic !== ackTopic) return;
      try {
        const ack = JSON.parse(payload.toString('utf8'));
        if (ack.cmd === action && ack.nonce === nonce && ack.status === 'rejected') {
          const failure = new Error('Perangkat menolak perintah.');
          failure.deviceRejected = true;
          const reasons = { sensor: 'AS5600 I²C atau magnet belum terbaca. Periksa sensor pengirim.',
            unstable: 'Sudut belum stabil. Tahan sayap, lalu rekam kembali.',
            session: 'Sesi kalibrasi berakhir atau berubah. Mulai kalibrasi kembali.',
            geometry: 'Empat posisi tidak membentuk satu putaran yang valid. Ulangi kalibrasi sesuai urutan.',
            storage: 'ESP gagal menyimpan kalibrasi. Kalibrasi sebelumnya tetap digunakan.',
            busy: 'ESP masih merekam posisi. Tunggu beberapa detik.',
            incomplete: 'Empat arah belum lengkap. Rekam semua posisi sebelum menyimpan.' };
          failure.publicMessage = reasons[ack.reason] || 'Perangkat menolak kalibrasi. Periksa Serial Monitor pengirim.';
          finish(failure); return;
        }
        if (recordCommandAck(confirmedDevices, ack, action, nonce)) finish(null, ack.result);
      } catch {}
    });
    client.on('connect', () => {
      client.subscribe(ackTopic, { qos: 1 }, (error) => {
        if (error) return finish(error);
        const configuration = action === 'apply_settings';
        const topic = `bayu/stations/${stationId}/${configuration ? 'config' : 'cmd'}`;
        client.publish(topic, JSON.stringify({ cmd: action, nonce,
          ...(action === 'calibrate_four' ? calibration : {}),
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
    const { action, calibration: requestedCalibration, stationId: target = 'angin-01' } = await request.json();
    if (typeof target !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(target)) {
      return Response.json({ error: 'ID stasiun tidak valid.' }, { status: 400, headers });
    }
    const stationId = target.toLowerCase();
    const station = await getStation(stationId);
    if (!canManageStation(user, station)) return Response.json({ error: 'Akses stasiun ditolak.' }, { status: 403, headers });

    const validActions = ['calibrate_four', 'calibrate_zero', 'buzzer_mute', 'buzzer_unmute', 'request_telemetry', 'apply_settings'];
    if (!validActions.includes(action)) {
      return Response.json({ error: `Perintah '${action}' tidak dikenali.` }, { status: 400, headers });
    }

    let calibration;
    if (action === 'calibrate_four') {
      try { calibration = calibrationPayload(requestedCalibration); }
      catch { return Response.json({ error: 'Permintaan kalibrasi tidak valid.' }, { status: 400, headers }); }
    }
    try {
      if (action === 'calibrate_four') {
        const result = await runServerCalibration(stationId, user, calibration);
        return Response.json({ success: true, result, message: 'Kalibrasi diproses di backend.' }, { headers });
      }
      if (action === 'apply_settings' && !station?.settings) return Response.json({ error: 'Daftarkan stasiun terlebih dahulu.' }, { status: 400, headers });
      const result = await publishCommand(stationId, action, station, calibration);
      return Response.json({ success: true, result, message: `ESP ${stationId} mengonfirmasi ${action}.` }, { headers });
    } catch (error) {
      console.error('BAYU command failed:', error.code ?? error.name);
      if (error.calibrationError) return Response.json({ error: error.message }, { status: error.status, headers });
      if (action === 'calibrate_four') return Response.json({ error: 'Penyimpanan atau data kalibrasi belum tersedia. Coba kembali.' }, { status: 503, headers });
      if (error.deviceRejected) return Response.json({ error: error.publicMessage }, { status: 422, headers });
      const noAck = error.message === 'ESP tidak mengonfirmasi perintah.';
      const timeoutMessage = action === 'buzzer_mute' || action === 'buzzer_unmute'
        ? 'Mute belum dikonfirmasi kedua ESP. Periksa koneksi pengirim dan penerima serta firmware terbaru.'
        : action === 'calibrate_zero' || action === 'calibrate_four'
          ? 'Pengirim belum mengonfirmasi kalibrasi utara. Periksa Serial Monitor pengirim, sensor arah, dan izin MQTT /cmd serta /ack.'
          : 'Pengirim belum mengonfirmasi perintah. Periksa koneksi MQTT dan firmware pengirim.';
      return Response.json({ error: noAck ? timeoutMessage : 'Gagal mengirim perintah ke broker MQTT.' }, { status: noAck ? 504 : 503, headers });
    }
  } catch (error) {
    return Response.json({ error: 'Format permintaan tidak valid.' }, { status: 400, headers });
  }
}
