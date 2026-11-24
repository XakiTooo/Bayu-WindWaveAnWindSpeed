import { sameOrigin } from '@/lib/admin-session.mjs';
import { createUser, currentUser, listUsers, setUserEnabled } from '@/lib/auth-store.mjs';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

async function admin(request) {
  try { return (await currentUser(request))?.role === 'admin'; }
  catch { return null; }
}

export async function GET(request) {
  const allowed = await admin(request);
  if (allowed === null) return Response.json({ error: 'Database akun belum tersedia.' }, { status: 503, headers });
  if (!allowed) return Response.json({ error: 'Akses admin diperlukan.' }, { status: 403, headers });
  try { return Response.json({ users: await listUsers() }, { headers }); }
  catch { return Response.json({ error: 'Daftar akun belum tersedia.' }, { status: 503, headers }); }
}

export async function POST(request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Asal permintaan tidak valid.' }, { status: 403, headers });
  let actor;
  try { actor = await currentUser(request); } catch { return Response.json({ error: 'Database akun belum tersedia.' }, { status: 503, headers }); }
  if (actor?.role !== 'admin') return Response.json({ error: 'Akses admin diperlukan.' }, { status: 403, headers });
  let input;
  try { input = await request.json(); } catch { return Response.json({ error: 'Format tidak valid.' }, { status: 400, headers }); }
  if (!input || typeof input !== 'object') return Response.json({ error: 'Format tidak valid.' }, { status: 400, headers });
  try { return Response.json({ user: await createUser(input, actor.username) }, { status: 201, headers }); }
  catch (error) {
    if (error.message?.includes('tidak valid') || error.message?.includes('Password') || error.message?.includes('Nama') || error.message?.includes('dipakai')) {
      return Response.json({ error: error.message }, { status: 400, headers });
    }
    console.error('BAYU create user failed:', error.code ?? error.name);
    return Response.json({ error: 'Database akun belum tersedia.' }, { status: 503, headers });
  }
}

export async function PATCH(request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Asal permintaan tidak valid.' }, { status: 403, headers });
  let actor;
  try { actor = await currentUser(request); } catch { return Response.json({ error: 'Database akun belum tersedia.' }, { status: 503, headers }); }
  if (actor?.role !== 'admin') return Response.json({ error: 'Akses admin diperlukan.' }, { status: 403, headers });
  let username, enabled;
  try { ({ username, enabled } = await request.json()); } catch { return Response.json({ error: 'Format tidak valid.' }, { status: 400, headers }); }
  try { return Response.json({ user: await setUserEnabled(username, enabled, actor.username) }, { headers }); }
  catch (error) {
    if (error.message?.includes('tidak valid') || error.message?.includes('tidak ditemukan')) {
      return Response.json({ error: error.message }, { status: 400, headers });
    }
    console.error('BAYU update user failed:', error.code ?? error.name);
    return Response.json({ error: 'Database akun belum tersedia.' }, { status: 503, headers });
  }
}
