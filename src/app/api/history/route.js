import { timingSafeEqual } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getDashboardAdminApp } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request) {
  const url = new URL(request.url);
  const stationId = url.searchParams.get('stationId')?.toLowerCase();
  const key = request.headers.get('x-bayu-read-key');
  const expected = process.env.BAYU_TELEMETRY_SHARE_KEY;
  if (!expected || !key || Buffer.byteLength(key) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(expected))) {
    return Response.json({ error: 'Akses tidak valid.' }, { status: 403, headers });
  }
  if (!stationId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stationId) || stationId.length > 64) {
    return Response.json({ error: 'ID stasiun tidak valid.' }, { status: 400, headers });
  }
  try {
    const snapshot = await getFirestore(getDashboardAdminApp()).collection(`stations/${stationId}/readings`)
      .orderBy('receivedAt', 'desc').limit(200).get();
    const rows = snapshot.docs.map((doc) => {
      const data = doc.data();
      const timestamp = data.receivedAt?.toMillis?.();
      return { timestamp, id: stationId.toUpperCase(), speed: data.windSpeedKmh,
        angle: data.windDirectionDeg, battery: data.battery ?? null,
        lat: data.gps?.fix ? data.gps.lat : data.lat,
        lng: data.gps?.fix ? data.gps.lon : data.lng ?? data.lon,
        source: 'mqtt', dataType: 'HARDWARE_REAL' };
    }).filter((row) => Number.isFinite(row.timestamp) && Number.isFinite(row.speed));
    return Response.json({ rows }, { headers });
  } catch (error) {
    console.error('BAYU history read failed:', error.code ?? error.name);
    return Response.json({ error: 'Riwayat belum tersedia.' }, { status: 503, headers });
  }
}
