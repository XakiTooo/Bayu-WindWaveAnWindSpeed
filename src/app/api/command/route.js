import { timingSafeEqual } from 'node:crypto';
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
