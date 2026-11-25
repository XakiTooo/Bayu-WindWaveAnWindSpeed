import { getDatabase } from 'firebase-admin/database';
import { getDashboardAdminApp } from '@/lib/firebase-admin';
import { validReading } from '@/lib/telemetry.mjs';
import { canReadStation } from '@/lib/station-access.mjs';
import { normalizeStationId, getStation, applyWebConfiguration } from '@/lib/station-registry.mjs';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };

export async function GET(request) {
  const stationId = normalizeStationId(new URL(request.url).searchParams.get('stationId') || 'angin-01');
  if (!stationId) return Response.json({ error: 'ID tidak valid.' }, { status: 400, headers });
  try {
    if (!(await canReadStation(request, stationId))) return Response.json({ error: 'Akses tidak valid.' }, { status: 403, headers });
    const snapshot = await getDatabase(getDashboardAdminApp()).ref(`stations/${stationId}/${process.env.BAYU_LOCAL_WORKER === '1' ? 'processedLatest' : 'latest'}`).get();
    const reading = validReading(stationId, snapshot.val());
    if (!reading) return Response.json({ stationId, status: 'waiting', latest: null }, { headers });
    const registry = await getStation(stationId);
    const configured = applyWebConfiguration(reading, registry?.settings, registry?.directionCalibration);
    const ageSeconds = Math.max(0, Math.floor((Date.now() - reading.receivedAt) / 1000));
    return Response.json({ stationId, ...configured, status: ageSeconds <= 30 ? 'recent' : 'stale',
      source: 'mqtt', ageSeconds, receivedAtIso: new Date(reading.receivedAt).toISOString() }, { headers });
  } catch (error) {
    console.error('BAYU telemetry read failed:', error.code || error.name);
    return Response.json({ error: 'Telemetri belum tersedia. Periksa Firebase dan webhook EMQX.' }, { status: 503, headers });
  }
}
