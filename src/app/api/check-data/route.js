import { timingSafeEqual } from 'node:crypto';
import mqtt from 'mqtt';
import { getDatabase } from 'firebase-admin/database';
import { getDashboardAdminApp } from '@/lib/firebase-admin';
import { validReading } from '@/lib/telemetry.mjs';

export const runtime = 'nodejs';

const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

// Singleton MQTT subscriber langsung ke EMQX Cloud broker agar data real GPS & sensor tidak terpotong
const packets = globalThis.__bayuStationPackets ||= new Map();
const subscriptions = globalThis.__bayuStationSubscriptions ||= new Set(['angin-01']);

function ensureMqtt(stationId = 'angin-01') {
  const { MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD } = process.env;
  if (!MQTT_URL || !MQTT_USERNAME || !MQTT_PASSWORD) return;
  const isNew = !subscriptions.has(stationId);
  subscriptions.add(stationId);
  if (globalThis.__bayuMqttClient) {
    if (isNew && globalThis.__bayuMqttClient.connected) globalThis.__bayuMqttClient.subscribe(`bayu/stations/${stationId}/telemetry`);
    return;
  }
  try {
    const client = mqtt.connect(MQTT_URL, {
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
      rejectUnauthorized: true,
      reconnectPeriod: 3000,
    });

    client.on('error', (error) => console.warn('Koneksi MQTT gagal:', error.code ?? error.name));

    client.on('connect', () => {
      for (const id of subscriptions) client.subscribe(`bayu/stations/${id}/telemetry`);
    });

    client.on('message', (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString('utf8'));
        const id = /^bayu\/stations\/([a-z0-9-]{1,64})\/telemetry$/.exec(topic)?.[1];
        const payloadId = data?.stationId || data?.station_id;
        if (id && typeof payloadId === 'string' && payloadId.toLowerCase() === id) {
          packets.set(id, { data, receivedAt: Date.now() });
        }
      } catch {}
    });

    globalThis.__bayuMqttClient = client;
  } catch (err) {
    console.warn('Gagal menghubungkan MQTT subscriber lokal:', err.message);
  }
}

// Inisialisasi MQTT saat file dimuat
ensureMqtt();

function authorized(request) {
  const secret = process.env.BAYU_TELEMETRY_SHARE_KEY;
  const supplied = new URL(request.url).searchParams.get('key');
  if (!secret || !supplied || secret.length !== supplied.length) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Link tidak valid.' }, { status: 404, headers });
  }

  const stationId = new URL(request.url).searchParams.get('stationId')?.toLowerCase() || 'angin-01';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stationId) || stationId.length > 64) {
    return Response.json({ error: 'ID stasiun tidak valid.' }, { status: 400, headers });
  }
  ensureMqtt(stationId);
  const packet = packets.get(stationId);
  const latestMqttPacket = packet?.data;
  const lastPacketTime = packet?.receivedAt;

  // 1. Prioritas Utama: Telemetri MQTT riil langsung dari broker (lengkap dengan GPS hardware & satelit)
  if (latestMqttPacket) {
    const ageSeconds = Math.max(0, Math.floor((Date.now() - lastPacketTime) / 1000));
    const speed = Number.isFinite(latestMqttPacket.windSpeedKmh)
      ? latestMqttPacket.windSpeedKmh
      : (latestMqttPacket.speed_kmh || 0);
    const angle = Number.isFinite(latestMqttPacket.windDirectionDeg)
      ? latestMqttPacket.windDirectionDeg
      : (latestMqttPacket.direction_deg || 0);

    let lat = undefined;
    let lon = undefined;
    const hasFix = latestMqttPacket.gps && (latestMqttPacket.gps.fix === true || latestMqttPacket.gps.fix === 'true');
    if (hasFix && typeof latestMqttPacket.gps.lat === 'number' && latestMqttPacket.gps.lat !== 0) {
      lat = latestMqttPacket.gps.lat;
      lon = latestMqttPacket.gps.lon;
    } else if (!latestMqttPacket.gps && typeof latestMqttPacket.lat === 'number' && latestMqttPacket.lat !== 0) {
      lat = latestMqttPacket.lat;
      lon = latestMqttPacket.lon || latestMqttPacket.lng;
    }

    return Response.json({
      stationId: latestMqttPacket.stationId || latestMqttPacket.station_id || stationId,
      status: ageSeconds <= 30 ? 'recent' : 'stale',
      source: 'mqtt',
      windSpeedKmh: speed,
      windDirectionDeg: angle,
      receivedAt: lastPacketTime,
      receivedAtIso: new Date(lastPacketTime).toISOString(),
      ageSeconds,
      gps: latestMqttPacket.gps,
      ...(lat !== undefined ? { lat, lon, lng: lon } : {}),
      battery: latestMqttPacket.battery,
      rawStatus: latestMqttPacket.status,
    }, { headers });
  }

  // 2. Cadangan: Firebase Database lokal (jika kredensial ada)
  const shareKey = process.env.BAYU_TELEMETRY_SHARE_KEY;
  const hasCreds = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS);

  if (hasCreds) {
    try {
      const snapshot = await getDatabase(getDashboardAdminApp())
        .ref(`stations/${stationId}/latest`).get();
      const reading = validReading(stationId, snapshot.val());
      if (reading) {
        const ageSeconds = Math.max(0, Math.floor((Date.now() - reading.receivedAt) / 1000));
        return Response.json({
          stationId,
          status: ageSeconds <= 30 ? 'recent' : 'stale',
          source: 'mqtt',
          ...reading,
          receivedAtIso: new Date(reading.receivedAt).toISOString(),
          ageSeconds,
        }, { headers });
      }
    } catch (error) {
      console.warn('Gagal membaca Firebase Admin lokal:', error.message);
    }
  }

  // 3. Cadangan Terakhir: Upstream Vercel
  const upstreamUrl = new URL('https://bayu-windwave-and-windspeed.vercel.app/api/check-data');
  upstreamUrl.searchParams.set('stationId', stationId);
  upstreamUrl.searchParams.set('key', shareKey);
  if (new URL(request.url).hostname === upstreamUrl.hostname) {
    return Response.json({ error: 'Data belum bisa dibaca.' }, { status: 503, headers });
  }
  try {
    const upstream = await fetch(upstreamUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (upstream.ok) {
      const liveData = await upstream.json();
      if (liveData.stationId?.toLowerCase() === stationId) return Response.json(liveData, { headers });
    }
  } catch (fallbackErr) {
    console.warn('Fallback upstream Vercel gagal:', fallbackErr.message);
  }

  return Response.json({ error: 'Data belum bisa dibaca.' }, { status: 503, headers });
}
