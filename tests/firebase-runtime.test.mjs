import test from 'node:test';
import { execFileSync } from 'node:child_process';

test('Firebase Auth loads and resolves RSA signing keys when require(ESM) is disabled', () => {
  execFileSync(process.execPath, ['--no-experimental-require-module', '-e', `
    const assert = require('node:assert/strict');
    const { createRequire } = require('node:module');
    const { generateKeyPairSync } = require('node:crypto');
    const authPath = require.resolve('firebase-admin/auth');
    const { getAuth } = require(authPath);
    assert.equal(typeof getAuth, 'function');
    const jwksClient = createRequire(authPath)('jwks-rsa');
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'qa-key', alg: 'RS256', use: 'sig' };
    const client = jwksClient({ jwksUri: 'https://example.invalid/jwks', fetcher: async () => ({ keys: [jwk] }) });
    client.getSigningKey('qa-key').then((key) => {
      assert.equal(key.getPublicKey(), publicKey.export({ format: 'pem', type: 'spki' }));
    }).catch((error) => { console.error(error); process.exitCode = 1; });
  `], { cwd: process.cwd(), stdio: 'pipe', timeout: 15000 });
});
