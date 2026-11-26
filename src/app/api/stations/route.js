import { currentUser } from '@/lib/auth-store.mjs';
import { sameOrigin } from '@/lib/admin-session.mjs';
import { listVisibleStations, registerStation, stationTopics } from '@/lib/station-registry.mjs';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request) {
  try {
    const user = await currentUser(request);
    return Response.json({ stations: await listVisibleStations(user) }, { headers });
  } catch { return Response.json({ error: 'Daftar stasiun belum tersedia.' }, { status: 503, headers }); }
}

export async function POST(request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Asal permintaan tidak valid.' }, { status: 403, headers });
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: 'Silakan masuk.' }, { status: 401, headers });
    const input = await request.json();
    if (!input || typeof input !== 'object') return Response.json({ error: 'Format tidak valid.' }, { status: 400, headers });
    const station = await registerStation(user, input);
    return Response.json({ station, topics: stationTopics(station.id) }, { status: 201, headers });
  } catch (error) {
    const status = error.code === 6 ? 409 : error instanceof SyntaxError || error.message?.includes('tidak valid') ? 400 : 503;
    return Response.json({ error: status === 409 ? 'ID stasiun sudah terdaftar.' : status === 400 ? 'Nama, ID, atau koordinat tidak valid.' : 'Pendaftaran belum tersedia. Periksa koneksi Firestore.' }, { status, headers });
  }
}
