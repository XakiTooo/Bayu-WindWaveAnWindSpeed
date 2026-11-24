import { cookieHeader, sameOrigin } from '@/lib/admin-session.mjs';
import { currentUser, loginUser, revokeSession, usingLocalAuth } from '@/lib/auth-store.mjs';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request) {
  try {
    const user = await currentUser(request);
    return Response.json({ authenticated: Boolean(user), user, mode: usingLocalAuth() ? 'local-demo' : 'firestore' }, { headers });
  } catch {
    return Response.json({ error: usingLocalAuth() ? 'Penyimpanan akun demo lokal gagal dibaca.' : 'Database akun belum tersedia.' }, { status: 503, headers });
  }
}

export async function POST(request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Asal permintaan tidak valid.' }, { status: 403, headers });
  let username, password;
  try { ({ username, password } = await request.json()); } catch { return Response.json({ error: 'Format tidak valid.' }, { status: 400, headers }); }
  try {
    const result = await loginUser(username, password);
    if (!result) return Response.json({ error: 'Username atau password salah.' }, { status: 401, headers });
    return Response.json({ authenticated: true, user: result.user },
      { headers: { ...headers, 'Set-Cookie': cookieHeader(result.token, request) } });
  } catch (error) {
    console.error('BAYU login failed:', error.code ?? error.name);
    return Response.json({ error: usingLocalAuth() ? 'Penyimpanan akun demo lokal gagal. Periksa folder .local-data.' : 'Server belum terhubung ke Firestore. Pasang kredensial Firebase Admin di .env.local, lalu restart server.' }, { status: 503, headers });
  }
}

export async function DELETE(request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Asal permintaan tidak valid.' }, { status: 403, headers });
  try { await revokeSession(request); } catch (error) { console.error('BAYU logout failed:', error.code ?? error.name); }
  return Response.json({ authenticated: false }, { headers: { ...headers, 'Set-Cookie': cookieHeader('', request) } });
}
