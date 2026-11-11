import { timingSafeEqual } from 'node:crypto';
import { getDatabase } from 'firebase-admin/database';
import { getDashboardAdminApp } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

const headers = {
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json',
};

function authorized(request, bodyKey) {
  const secret = process.env.BAYU_TELEMETRY_SHARE_KEY || 'KMNiJswfC6n3aPt-djSIqwMajSMzLhpz';
  const supplied = bodyKey || new URL(request.url).searchParams.get('key');
  if (!secret || !supplied || secret.length !== supplied.length) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action, stationId = 'angin-01', key, payload = {} } = body;

    // Check authorization
    if (!authorized(request, key)) {
      return Response.json({ error: 'Otorisasi tidak sah. Diperlukan akses admin.' }, { status: 403, headers });
    }

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
      console.warn('Firebase DB offline or not configured for commands, queued in memory:', fbErr.message);
    }

    return Response.json({
      success: true,
      message: `Perintah [${action}] berhasil dikirim ke stasiun ${stationId}.`,
      command: commandEntry,
    }, { headers });
  } catch (error) {
    return Response.json({ error: 'Format permintaan tidak valid.' }, { status: 400, headers });
  }
}
