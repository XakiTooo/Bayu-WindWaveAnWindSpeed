import { timingSafeEqual } from 'node:crypto';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import { getDashboardAdminApp } from '@/lib/firebase-admin';
import { validReading } from '@/lib/telemetry.mjs';

export const runtime = 'nodejs';
export const maxDuration = 15;

const topicPattern = /^bayu\/stations\/([a-z0-9-]{1,64})\/telemetry$/;

function authorized(request) {
  const secret = process.env.BAYU_EMQX_WEBHOOK_SECRET;
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!secret || !token) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let message, payload;
  try {
    message = await request.json();
    payload = typeof message?.payload === 'string' ? JSON.parse(message.payload) : message?.payload;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const stationId = topicPattern.exec(message?.topic)?.[1];
  const receivedAt = message?.timestamp;
  const reading = stationId && validReading(stationId, { ...payload, receivedAt });
  if (!reading || !Number.isSafeInteger(receivedAt) || receivedAt > Date.now() + 60_000) {
    return Response.json({ error: 'Invalid telemetry' }, { status: 400 });
  }

  try {
    const app = getDashboardAdminApp();
    const latest = getDatabase(app).ref(`stations/${stationId}/latest`);
    const minute = Math.floor(receivedAt / 60_000);
    const history = getFirestore(app).doc(`stations/${stationId}/readings/${minute}`);
    const data = { stationId, ...reading };
    const [realtime, historical] = await Promise.allSettled([
      latest.transaction((current) => current?.receivedAt >= receivedAt ? undefined : data),
      history.create({ ...data, receivedAt: new Date(receivedAt) }).catch((error) => {
        if (error.code !== 6) throw error;
      }),
    ]);
    if (realtime.status === 'rejected') throw realtime.reason;
    if (historical.status === 'rejected') throw historical.reason;
    return Response.json({ ok: true, stationId });
  } catch (error) {
    console.error('BAYU ingest failed:', error.code ?? error.name);
    return Response.json({ error: 'Storage unavailable' }, { status: 503 });
  }
}
