import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const userIdPattern = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export function cleanUsername(value) {
  const id = String(value || '').trim().toLowerCase();
  return userIdPattern.test(id) ? id : null;
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Password minimal 12 dan maksimal 128 karakter.');
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [algorithm, saltHex, hashHex] = stored.split(':');
  if (algorithm !== 'scrypt' || !/^[0-9a-f]{32}$/.test(saltHex || '') || !/^[0-9a-f]{128}$/.test(hashHex || '')) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  return timingSafeEqual(derived, Buffer.from(hashHex, 'hex'));
}
