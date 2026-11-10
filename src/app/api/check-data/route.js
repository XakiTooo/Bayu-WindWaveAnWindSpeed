import { timingSafeEqual } from 'node:crypto';
import { getDatabase } from 'firebase-admin/database';
import { getDashboardAdminApp } from '@/lib/firebase-admin';
import { validReading } from '@/lib/telemetry.mjs';

export const runtime = 'nodejs';

const stationId = 'angin-01';
const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

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

  try {
    const snapshot = await getDatabase(getDashboardAdminApp())
      .ref(`stations/${stationId}/latest`).get();
    const reading = validReading(stationId, snapshot.val());
    if (!reading) return Response.json({ stationId, status: 'waiting', latest: null }, { headers });

    const ageSeconds = Math.max(0, Math.floor((Date.now() - reading.receivedAt) / 1000));
    return Response.json({
      stationId,
      status: ageSeconds <= 30 ? 'recent' : 'stale',
      source: 'mqtt',
      ...reading,
      receivedAtIso: new Date(reading.receivedAt).toISOString(),
      ageSeconds,
    }, { headers });
  } catch (error) {
    console.error('BAYU check-data failed:', error.code ?? error.name);
    return Response.json({ error: 'Data belum bisa dibaca.' }, { status: 503, headers });
  }
}
