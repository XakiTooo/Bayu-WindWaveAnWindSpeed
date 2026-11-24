import { randomBytes, createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getDashboardAdminApp } from './firebase-admin.js';
import { cleanUsername, hashPassword, verifyPassword } from './auth-crypto.mjs';
import * as local from './local-auth.mjs';

export const sessionCookie = 'bayu_session';
const sessionLifetimeMs = 12 * 60 * 60 * 1000;

export function usingLocalAuth() {
  return process.env.NODE_ENV === 'development' && process.env.BAYU_LOCAL_AUTH === '1' &&
    !process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

function database() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Firebase Admin credentials are not configured.');
  }
  return getFirestore(getDashboardAdminApp());
}
function publicUser(id, data) { return { username: id, name: data.name || id, role: data.role === 'admin' ? 'admin' : 'viewer' }; }
function sessionId(token) { return createHash('sha256').update(token).digest('hex'); }
function readToken(request) {
  const value = request.headers.get('cookie')?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
  return /^[0-9a-f]{64}$/.test(value || '') ? value : null;
}

export async function loginUser(username, password) {
  if (usingLocalAuth()) return local.loginLocal(username, password);
  const id = cleanUsername(username);
  if (!id || typeof password !== 'string') return null;
  const db = database();
  const userRef = db.doc(`dashboardUsers/${id}`);
  let snapshot = await userRef.get();
  if (!snapshot.exists && id === 'admin' && process.env.BAYU_ADMIN_PASSWORD === password && password.length >= 12) {
    const passwordHash = await hashPassword(password);
    try {
      await userRef.create({ name: 'Administrator BAYU', role: 'admin', enabled: true,
        passwordHash, createdAt: Date.now(), createdBy: 'bootstrap' });
    } catch (error) { if (error.code !== 6) throw error; }
    snapshot = await userRef.get();
  }
  if (!snapshot.exists || snapshot.data().enabled === false || snapshot.data().lockedUntil > Date.now()) return null;
  if (!(await verifyPassword(password, snapshot.data().passwordHash))) {
    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(userRef);
      if (!fresh.exists) return;
      const failures = (fresh.data().failedAttempts || 0) + 1;
      transaction.update(userRef, { failedAttempts: failures >= 5 ? 0 : failures,
        lockedUntil: failures >= 5 ? Date.now() + 15 * 60_000 : 0 });
    });
    return null;
  }
  await userRef.update({ failedAttempts: 0, lockedUntil: 0, lastLoginAt: Date.now() });
  const token = randomBytes(32).toString('hex');
  await db.doc(`dashboardSessions/${sessionId(token)}`).create({ userId: id, expiresAt: new Date(Date.now() + sessionLifetimeMs) });
  return { token, user: publicUser(id, snapshot.data()) };
}

export async function currentUser(request) {
  if (usingLocalAuth()) return local.currentLocalUser(request);
  const token = readToken(request);
  if (!token) return null;
  const db = database();
  const session = await db.doc(`dashboardSessions/${sessionId(token)}`).get();
  if (!session.exists || !Number.isFinite(session.data().expiresAt?.toMillis?.()) || session.data().expiresAt.toMillis() <= Date.now()) return null;
  const id = cleanUsername(session.data().userId);
  if (!id) return null;
  const user = await db.doc(`dashboardUsers/${id}`).get();
  return user.exists && user.data().enabled !== false ? publicUser(id, user.data()) : null;
}

export async function revokeSession(request) {
  if (usingLocalAuth()) return local.revokeLocalSession(request);
  const token = readToken(request);
  if (token) await database().doc(`dashboardSessions/${sessionId(token)}`).delete();
}

export async function listUsers() {
  if (usingLocalAuth()) return local.listLocalUsers();
  const snapshot = await database().collection('dashboardUsers').get();
  return snapshot.docs.map((doc) => ({ ...publicUser(doc.id, doc.data()), enabled: doc.data().enabled !== false }));
}

export async function createUser({ username, name, password, role }, creator) {
  if (usingLocalAuth()) return local.createLocalUser({ username, name, password, role }, creator);
  const id = cleanUsername(username);
  if (!id || !['admin', 'viewer'].includes(role)) throw new Error('Username atau role tidak valid.');
  const displayName = String(name || id).trim();
  if (!displayName || displayName.length > 80) throw new Error('Nama harus 1–80 karakter.');
  const passwordHash = await hashPassword(password);
  try {
    await database().doc(`dashboardUsers/${id}`).create({ name: displayName, role, enabled: true,
      passwordHash, createdAt: Date.now(), createdBy: creator });
  } catch (error) {
    if (error.code === 6) throw new Error('Username sudah dipakai.');
    throw error;
  }
  return { username: id, name: displayName, role, enabled: true };
}

export async function setUserEnabled(username, enabled, actor) {
  if (usingLocalAuth()) return local.setLocalUserEnabled(username, enabled, actor);
  const id = cleanUsername(username);
  if (!id || typeof enabled !== 'boolean' || (id === actor && !enabled)) throw new Error('Perubahan akun tidak valid.');
  const ref = database().doc(`dashboardUsers/${id}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error('Akun tidak ditemukan.');
  await ref.update({ enabled, updatedAt: Date.now(), updatedBy: actor });
  return { ...publicUser(id, snapshot.data()), enabled };
}
