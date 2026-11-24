import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiResponse } from '../src/lib/api-response.mjs';

test('empty server failures expose HTTP status instead of a JSON parse exception', async () => {
  await assert.rejects(readApiResponse(new Response('', { status: 500 })), /HTTP 500/);
});

test('non-JSON deployment responses expose HTTP status', async () => {
  await assert.rejects(readApiResponse(new Response('<html>Forbidden</html>', { status: 403 })), /HTTP 403/);
});

test('API JSON errors and successful sessions remain available to callers', async () => {
  assert.deepEqual(await readApiResponse(Response.json({ error: 'Akses ditolak.' }, { status: 403 })), { error: 'Akses ditolak.' });
  assert.deepEqual(await readApiResponse(Response.json({ authenticated: true })), { authenticated: true });
});
