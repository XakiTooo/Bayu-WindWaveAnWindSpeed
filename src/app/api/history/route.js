import { canReadStation } from '@/lib/station-access.mjs';
import { getStation, applyWebConfiguration } from '@/lib/station-registry.mjs';
import { getFirestore } from 'firebase-admin/firestore';
import { getDashboardAdminApp } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request) {
  const url = new URL(request.url);
  const stationId = url.searchParams.get('stationId')?.toLowerCase();
  if (!stationId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stationId) || stationId.length > 64) {
    return Response.json({ error: 'ID stasiun tidak valid.' }, { status: 400, headers });
  }
  try {
    if (!(await canReadStation(request, stationId))) return Response.json({ error: 'Akses tidak valid.' }, { status: 403, headers });
    const station = await getStation(stationId);
    const snapshot = await getFirestore(getDashboardAdminApp()).collection(`stations/${stationId}/readings`)
      .orderBy('receivedAt', 'desc').limit(200).get();
    const rows = snapshot.docs.map((doc) => {
      const data = doc.data();
      const timestamp = data.receivedAt?.toMillis?.();
      return { timestamp, id: stationId.toUpperCase(), speed: data.windSpeedKmh,
        angle: applyWebConfiguration(data, station?.settings).windDirectionDeg, battery: data.battery ?? null,
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
