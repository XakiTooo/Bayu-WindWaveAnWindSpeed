import { timingSafeEqual } from 'node:crypto';
import { currentUser } from './auth-store.mjs';
import { getStationEntry, canManageStation, isPublicStation, normalizeStationId } from './station-registry.mjs';

export async function stationReadScope(request, id) {
  const station = await getStationEntry(id);
  if (station?.deletedAt) return null;
  const sharedIds = (process.env.BAYU_TELEMETRY_SHARE_STATION_IDS ?? 'angin-01,bayu-b24af944b173931c')
    .split(',').map(normalizeStationId);
  const expected = process.env.BAYU_TELEMETRY_SHARE_KEY;
  const supplied = request.headers.get('x-bayu-read-key') || new URL(request.url).searchParams.get('key');
  if (sharedIds.includes(id) && expected && supplied && Buffer.byteLength(expected) === Buffer.byteLength(supplied) &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return 'private';
  const user = await currentUser(request);
  if (canManageStation(user, station)) return 'private';
  return isPublicStation(station) ? 'public' : null;
}
