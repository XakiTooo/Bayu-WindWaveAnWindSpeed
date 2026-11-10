import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';

export function getDashboardAdminApp() {
  const existing = getApps().find(({ name }) => name === 'bayu-dashboard');
  if (existing) return existing;
  const account = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  return initializeApp({
    credential: account ? cert(JSON.parse(account)) : applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  }, 'bayu-dashboard');
}
