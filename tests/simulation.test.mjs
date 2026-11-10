import test from 'node:test';
import assert from 'node:assert/strict';
import { createStations, advance, state, applyScenario, direction, records, exportCsv, DEFAULT_SETTINGS } from '../src/lib/simulation.mjs';

test('alarm threshold is inclusive and takes priority over low battery', () => {
  const station = { ...createStations()[0], speed: 40, battery: 5 };
  assert.equal(state(station, DEFAULT_SETTINGS), 'alarm');
  assert.equal(state({ ...station, speed: 39.9 }, DEFAULT_SETTINGS), 'warning');
});
test('offline stations retain last measurement and timestamp', () => {
  const stations = createStations(1000000);
  const next = advance(stations, 1, 1004000);
  assert.deepEqual(next[4], stations[4]);
  assert.equal(state(next[4], DEFAULT_SETTINGS), 'offline');
  assert.equal(next[0].updated, 1004000);
  assert.equal(next[0].samples.length, 30);
  assert.equal(records(next).length, 4);
});
test('scenario changes apply to the selected station without mutating source', () => {
  const station = createStations(1000000)[0];
  const offline = applyScenario(station, 'offline', DEFAULT_SETTINGS, 1000000);
  assert.equal(offline.online, false);
  assert.equal(station.online, true);
  assert.equal(state(applyScenario(station, 'battery', DEFAULT_SETTINGS, 1000000), DEFAULT_SETTINGS), 'warning');
  assert.equal(state(applyScenario(station, 'alarm', DEFAULT_SETTINGS, 1000000), DEFAULT_SETTINGS), 'alarm');
});
test('direction wraps correctly across north and negative angles', () => {
  assert.equal(direction(360), 'Utara');
  assert.equal(direction(720), 'Utara');
  assert.equal(direction(-90), 'Barat');
  assert.equal(direction(225), 'Barat Daya');
});
test('CSV retains coordinates and marks records as simulated', () => {
  const csv = exportCsv(records(createStations(1000000)));
  assert.equal(csv.split('\n').length, 5);
  assert.match(csv, /latitude,longitude,data_type/);
  assert.match(csv, /-7.7823031,110.4159049,SIMULASI/);
});
