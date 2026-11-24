import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageStation, applyWebConfiguration, defaultStationSettings, normalizeStationId, validateStationSettings } from '../src/lib/station-registry.mjs';

test('station ownership is required and a signed-in viewer cannot control another owner device', () => {
  const owner = { username: 'owner', role: 'viewer' };
  assert.equal(canManageStation(owner, { ownerId: 'owner' }), true);
  assert.equal(canManageStation(owner, { ownerId: 'other' }), false);
  assert.equal(canManageStation(owner, null), false);
  assert.equal(canManageStation(null, { ownerId: 'owner' }), false);
  assert.equal(canManageStation({ username: 'admin', role: 'admin' }, null), true);
});

test('virtual correction wraps across north and preserves source direction', () => {
  const original = { windDirectionDeg: 350, windSpeedKmh: 20 };
  const result = applyWebConfiguration(original, { ...defaultStationSettings, directionOffsetDeg: 30 });
  assert.equal(result.windDirectionDeg, 20);
  assert.equal(result.rawWindDirectionDeg, 350);
  assert.equal(original.windDirectionDeg, 350);
  assert.equal(result.webStatus, 'BAHAYA');
});

test('station configuration rejects inverted thresholds and unsafe identifiers', () => {
  assert.throws(() => validateStationSettings({ ...defaultStationSettings, warningKmh: 20, dangerKmh: 10 }));
  assert.throws(() => validateStationSettings({ ...defaultStationSettings, directionOffsetDeg: NaN }));
  assert.equal(normalizeStationId('../other'), null);
  assert.equal(normalizeStationId('ANGIN-01'), 'angin-01');
});
