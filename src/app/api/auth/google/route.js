import { cookieHeader, sameOrigin } from '@/lib/admin-session.mjs';
import { loginGoogle } from '@/lib/auth-store.mjs';

export const runtime = 'nodejs';

export async function POST(request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!sameOrigin(request)) return Response.json({ error: 'Asal permintaan tidak valid.' }, { status: 403, headers });
  let idToken;
  try { ({ idToken } = await request.json()); }
  catch { return Response.json({ error: 'Format tidak valid.' }, { status: 400, headers }); }
  if (typeof idToken !== 'string' || idToken.length > 10000) return Response.json({ error: 'Token tidak valid.' }, { status: 400, headers });
  try {
    const result = await loginGoogle(idToken);
    if (!result) return Response.json({ error: 'Akun tidak diizinkan. Silakan masuk ulang.' }, { status: 403, headers });
    return Response.json({ authenticated: true, user: result.user }, { headers: { ...headers, 'Set-Cookie': cookieHeader(result.token, request) } });
  } catch (error) {
    console.error('Google login failed:', error.code || error.name);
    const invalid = error.code?.startsWith('auth/') && error.code !== 'auth/insufficient-permission';
    return Response.json({ error: invalid ? 'Login Google kedaluwarsa atau tidak valid. Silakan coba lagi.' : 'Firebase Authentication belum dapat diakses oleh server.' }, { status: invalid ? 401 : 503, headers });
  }
}
