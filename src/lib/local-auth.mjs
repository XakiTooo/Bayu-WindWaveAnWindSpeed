import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanUsername, hashPassword, verifyPassword } from './auth-crypto.mjs';

const directory = join(process.cwd(), '.local-data');
const file = join(directory, 'auth.json');
const lifetimeMs = 12 * 60 * 60 * 1000;
const sessionCookie = 'bayu_session';

function readStore() {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data?.users && data?.sessions) return data;
    throw new Error('Database akun lokal rusak.');
  } catch (error) {
    if (error.code === 'ENOENT') return { users: {}, sessions: {} };
    throw error;
  }
}

function writeStore(data) {
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `auth-${process.pid}-${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, file);
}

async function updateStore(operation) {
  const previous = globalThis.__bayuLocalAuthQueue || Promise.resolve();
  let unlock;
  const next = new Promise((resolve) => { unlock = resolve; });
  globalThis.__bayuLocalAuthQueue = previous.then(() => next);
  await previous;
  try {
    const data = readStore();
    const result = await operation(data);
    writeStore(data);
    return result;
  } finally { unlock(); }
}

function publicUser(id, account) {
  return { username: id, name: account.name || id, role: account.role === 'admin' ? 'admin' : 'viewer' };
}
function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
function readToken(request) {
  const token = request.headers.get('cookie')?.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
  return /^[0-9a-f]{64}$/.test(token || '') ? token : null;
}

export async function loginLocal(username, password) {
  const id = cleanUsername(username);
  if (!id || typeof password !== 'string') return null;
  return updateStore(async (store) => {
    if (!store.users[id] && id === 'admin' && password.length >= 12 && password === process.env.BAYU_ADMIN_PASSWORD) {
      store.users[id] = { name: 'Administrator BAYU', role: 'admin', enabled: true,
        passwordHash: await hashPassword(password), createdAt: Date.now() };
    }
    const account = store.users[id];
    if (!account || account.enabled === false || account.lockedUntil > Date.now()) return null;
    if (!(await verifyPassword(password, account.passwordHash))) {
      const failures = (account.failedAttempts || 0) + 1;
      account.failedAttempts = failures >= 5 ? 0 : failures;
      account.lockedUntil = failures >= 5 ? Date.now() + 15 * 60_000 : 0;
      return null;
    }
    account.failedAttempts = 0;
    account.lockedUntil = 0;
    account.lastLoginAt = Date.now();
    const token = randomBytes(32).toString('hex');
    store.sessions[tokenHash(token)] = { userId: id, expiresAt: Date.now() + lifetimeMs };
    return { token, user: publicUser(id, account) };
  });
}

export async function currentLocalUser(request) {
  const token = readToken(request);
  if (!token) return null;
  const store = readStore();
  const session = store.sessions[tokenHash(token)];
  const account = session && store.users[session.userId];
  return session?.expiresAt > Date.now() && account?.enabled !== false && account
    ? publicUser(session.userId, account) : null;
}

export async function revokeLocalSession(request) {
  const token = readToken(request);
  if (token) await updateStore((store) => { delete store.sessions[tokenHash(token)]; });
}

export async function listLocalUsers() {
  const store = readStore();
  return Object.entries(store.users).map(([id, account]) => ({ ...publicUser(id, account), enabled: account.enabled !== false }));
}

export async function createLocalUser({ username, name, password, role }, creator) {
  const id = cleanUsername(username);
  if (!id || !['admin', 'viewer'].includes(role)) throw new Error('Username atau role tidak valid.');
  const displayName = String(name || id).trim();
  if (!displayName || displayName.length > 80) throw new Error('Nama harus 1–80 karakter.');
  const passwordHash = await hashPassword(password);
  return updateStore((store) => {
    if (store.users[id]) throw new Error('Username sudah dipakai.');
    store.users[id] = { name: displayName, role, enabled: true, passwordHash,
      createdAt: Date.now(), createdBy: creator };
    return { username: id, name: displayName, role, enabled: true };
  });
}

export async function setLocalUserEnabled(username, enabled, actor) {
  const id = cleanUsername(username);
  if (!id || typeof enabled !== 'boolean' || (id === actor && !enabled)) throw new Error('Perubahan akun tidak valid.');
  return updateStore((store) => {
    const account = store.users[id];
    if (!account) throw new Error('Akun tidak ditemukan.');
    account.enabled = enabled;
    account.updatedAt = Date.now();
    account.updatedBy = actor;
    return { ...publicUser(id, account), enabled };
  });
}
