import { timingSafeEqual } from 'node:crypto';
import { currentUser } from './auth-store.mjs';
import { getStation, canManageStation } from './station-registry.mjs';

export async function canReadStation(request, id) {
  const expected = process.env.BAYU_TELEMETRY_SHARE_KEY;
  const supplied = request.headers.get('x-bayu-read-key') || new URL(request.url).searchParams.get('key');
  if (expected && supplied && Buffer.byteLength(expected) === Buffer.byteLength(supplied) &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return true;
  const user = await currentUser(request);
  if (!user) return false;
  return canManageStation(user, await getStation(id));
}
