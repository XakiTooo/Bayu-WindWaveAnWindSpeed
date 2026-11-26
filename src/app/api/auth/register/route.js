import { cookieHeader, sameOrigin } from '@/lib/admin-session.mjs';
import { registerUser } from '@/lib/auth-store.mjs';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Asal permintaan tidak valid.' }, { status: 403, headers });
  try {
    const result = await registerUser(await request.json());
    if (!result) throw new Error('Session unavailable');
    return Response.json({ authenticated: true, user: result.user }, {
      status: 201, headers: { ...headers, 'Set-Cookie': cookieHeader(result.token, request) },
    });
  } catch (error) {
    if (error.message === 'Username sudah dipakai.') return Response.json({ error: error.message }, { status: 409, headers });
    if (error instanceof SyntaxError || error.message === 'Data akun tidak valid.') {
      return Response.json({ error: 'Periksa nama, username, dan panjang password.' }, { status: 400, headers });
    }
    return Response.json({ error: 'Pendaftaran belum bisa diselesaikan. Coba masuk jika akun sudah dibuat.' }, { status: 503, headers });
  }
}
