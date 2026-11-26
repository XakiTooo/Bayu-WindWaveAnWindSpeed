import { calibratedDirection } from './direction-calibration.mjs';
import { randomBytes } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getDashboardAdminApp } from './firebase-admin.js';

export const defaultStationSettings = { warningKmh: 5, dangerKmh: 15, directionOffsetDeg: 0 };

export function normalizeStationId(value) {
  const id = typeof value === 'string' ? value.toLowerCase().trim() : '';
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 64 ? id : null;
}

export function validateStationSettings(value) {
  const keys = Object.keys(defaultStationSettings);
  if (!value || keys.some((key) => !Number.isFinite(value[key])) ||
      value.warningKmh < 0 || value.dangerKmh <= value.warningKmh || value.dangerKmh > 200 ||
      Math.abs(value.directionOffsetDeg) > 360) throw new Error('Ambang dan koreksi arah tidak valid.');
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

export function canManageStation(user, station) {
  return Boolean(user && !station?.deletedAt && (user.role === 'admin' || station?.ownerId === user.username));
}

function collection() { return getFirestore(getDashboardAdminApp()).collection('stationRegistry'); }

export async function getStationEntry(id) {
  const snapshot = await collection().doc(id).get();
  return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
}

export async function getStation(id) {
  const station = await getStationEntry(id);
  return station?.deletedAt ? null : station;
}

export async function archiveStation(id, user) {
  return getFirestore(getDashboardAdminApp()).runTransaction(async (transaction) => {
    const ref = collection().doc(id);
    const snapshot = await transaction.get(ref);
    const station = snapshot.data();
    if (!snapshot.exists || (station.ownerId !== user.username && user.role !== 'admin')) return false;
    // Keep the ID reserved so old device credentials cannot attach to a new registration.
    if (!station.deletedAt) {
      const now = Date.now();
      transaction.update(ref, { deletedAt: now, updatedAt: now, calibrationDraft: null });
    }
    return true;
  });
}

function publicStationIds() {
  return [...new Set((process.env.BAYU_PUBLIC_STATION_IDS ?? 'bayu-b24af944b173931c')
    .split(',').map(normalizeStationId).filter(Boolean))].slice(0, 20);
}

export function isPublicStation(station) {
  return Boolean(station && !station.deletedAt && publicStationIds().includes(station.id));
}

export function publicStation(station) {
  return { id: station.id, name: station.name,
    lat: Number(station.lat.toFixed(3)), lng: Number(station.lng.toFixed(3)),
    settings: { ...defaultStationSettings, warningKmh: station.settings?.warningKmh ?? 5,
      dangerKmh: station.settings?.dangerKmh ?? 15 } };
}

export async function listVisibleStations(user) {
  const owned = user ? await listStations(user) : [];
  const featured = await Promise.all(publicStationIds().filter(id => !owned.some(station => station.id === id)).map(getStation));
  return [...owned, ...featured.filter(station => station && Number.isFinite(station.lat) && Number.isFinite(station.lng)).map(publicStation)];
}

export async function listStations(user) {
  const query = user.role === 'admin' ? collection() : collection().where('ownerId', '==', user.username);
  const snapshot = await query.get();
  return snapshot.docs.flatMap((doc) => {
    const data = doc.data();
    return data.deletedAt ? [] : [{ ...data, id: doc.id }];
  });
}

export async function registerStation(user, input) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const coordinate = (value) => typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
  const lat = coordinate(input.lat), lng = coordinate(input.lng);
  if (!name || name.length > 80 ||
      !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
    throw new Error('Nama atau koordinat tidak valid.');
  }
  // Only an administrator can adopt an existing device ID.
  const id = user.role === 'admin' && input.id ? normalizeStationId(input.id) : 'bayu-' + randomBytes(8).toString('hex');
  if (!id) throw new Error('ID stasiun tidak valid.');
  const station = { name, lat, lng, ownerId: user.username, settings: defaultStationSettings,
    createdAt: Date.now(), updatedAt: Date.now(), provisioning: 'mqtt-credentials-required' };
  await collection().doc(id).create(station);
  return { id, ...station };
}

export async function saveStationSettings(id, user, input) {
  const settings = validateStationSettings(input);
  const db = getFirestore(getDashboardAdminApp());
  return db.runTransaction(async (transaction) => {
    const ref = collection().doc(id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !canManageStation(user, snapshot.data())) return null;
    transaction.update(ref, { settings, updatedAt: Date.now() });
    return settings;
  });
}

export function stationTopics(id) {
  const base = `bayu/stations/${id}`;
  return { telemetry: `${base}/telemetry`, command: `${base}/cmd`, configuration: `${base}/config`, acknowledgement: `${base}/ack` };
}

export function applyWebConfiguration(reading, settings = defaultStationSettings, calibration) {
  const rawDirection = reading.rawWindDirectionDeg ?? reading.windDirectionDeg;
  const corrected = calibratedDirection(reading, calibration);
  const angle = ((corrected + settings.directionOffsetDeg) % 360 + 360) % 360;
  const status = reading.windSpeedKmh >= settings.dangerKmh ? 'BAHAYA' : reading.windSpeedKmh >= settings.warningKmh ? 'WASPADA' : 'AMAN';
  return { ...reading, rawWindDirectionDeg: rawDirection, windDirectionDeg: angle, webStatus: status, settings };
}

export function validateStationLocation(value) {
  if(!value || !Number.isFinite(value.lat) || Math.abs(value.lat)>90 || !Number.isFinite(value.lng) || Math.abs(value.lng)>180) throw new Error('Koordinat tidak valid.');
  return {lat:value.lat,lng:value.lng};
}
export async function saveStationLocation(id, user, value) {
  const {lat,lng}=validateStationLocation(value);
  return getFirestore(getDashboardAdminApp()).runTransaction(async transaction=>{
    const ref=collection().doc(id), snapshot=await transaction.get(ref);
    if(!snapshot.exists || !canManageStation(user,snapshot.data()))return null;
    transaction.update(ref,{lat,lng,updatedAt:Date.now()});return {lat,lng};
  });
}
