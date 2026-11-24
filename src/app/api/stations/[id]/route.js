import { currentUser } from '@/lib/auth-store.mjs';
import { sameOrigin } from '@/lib/admin-session.mjs';
import { normalizeStationId, getStation, canManageStation, saveStationSettings } from '@/lib/station-registry.mjs';

export const runtime = 'nodejs';
export async function PATCH(request, context) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!sameOrigin(request)) return Response.json({ error: 'Asal permintaan tidak valid.' }, { status: 403, headers });
  try {
    const user = await currentUser(request);
    const id = normalizeStationId((await context.params).id);
    if (!id) return Response.json({ error: 'ID tidak valid.' }, { status: 400, headers });
    if (!canManageStation(user, await getStation(id))) return Response.json({ error: 'Akses stasiun ditolak.' }, { status: 403, headers });
    const settings = await saveStationSettings(id, user, await request.json());
    if (!settings) return Response.json({ error: 'Akses stasiun ditolak.' }, { status: 403, headers });
    return Response.json({ settings, scope: 'web' }, { headers });
  } catch (error) {
    return Response.json({ error: 'Konfigurasi belum tersimpan. Periksa nilai dan koneksi database.' }, { status: error instanceof SyntaxError || error.message?.includes('tidak valid') ? 400 : 503, headers });
  }
}
