export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).host === (request.headers.get('host') || new URL(request.url).host); } catch { return false; }
}

export function cookieHeader(token, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `bayu_session=${token || ''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 43200 : 0}${secure}`;
}
