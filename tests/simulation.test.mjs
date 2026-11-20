import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomStation, restoreCustomStations, applyStationTelemetry, removeCustomStation } from '../src/lib/stations.mjs';
import {
  createStations,
  advance,
  state,
  applyScenario,
  direction,
  records,
  exportCsv,
  calculateStats,
  calculateWindRose,
  getDeviceHealth,
  validateUserLogin,
  updateStationFromTelemetry,
  DEFAULT_SETTINGS
} from '../src/lib/simulation.mjs';

test('station registration rejects duplicate IDs and invalid coordinates', () => {
  const input = { id: '  angin-06 ', name: 'Lapangan Timur', lat: -7.78, lng: 110.41 };
  const station = createCustomStation(input);
  assert.equal(station.id, 'ANGIN-06');
  assert.equal(station.online, false);
  assert.deepEqual(station.samples, []);
  assert.throws(() => createCustomStation({ ...input, id: 'angin-01' }), /sudah digunakan/);
  assert.throws(() => createCustomStation(input, [station]), /sudah digunakan/);
  for (const invalid of [{ lat: 91 }, { lng: -181 }, { lat: '' }, { name: ' ' }, { id: '../bad' }]) {
    assert.throws(() => createCustomStation({ ...input, ...invalid }));
  }
});

test('stored station registration restores configuration without trusting cached live state', () => {
  const input = { id: 'angin-06', name: 'Lapangan Timur', lat: -7.78, lng: 110.41, online: true, speed: 100 };
  const restored = restoreCustomStations([null, input, input, { ...input, id: 'angin-01' }]);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].speed, 0);
  assert.equal(restored[0].online, false);
  assert.deepEqual(restoreCustomStations({}), []);
});

test('telemetry updates only its matching station and preserves the registered fallback', () => {
  const custom = createCustomStation({ id: 'angin-06', name: 'Lapangan Timur', lat: -7.78, lng: 110.41 });
  const stations = [...createStations(), custom];
  const updated = applyStationTelemetry(stations, { stationId: 'angin-06', status: 'recent', windSpeedKmh: 28, gps: { fix: false } });
  assert.equal(updated[0], stations[0]);
  assert.equal(updated[5].speed, 28);
  assert.equal(updated[5].online, true);
  assert.equal(state(updated[5], DEFAULT_SETTINGS), 'normal');
  assert.equal(updated[5].lat, -7.78);
  assert.equal(updated[5].lng, 110.41);
  assert.deepEqual(applyStationTelemetry(stations, { stationId: 'unknown' }), stations);
});

test('removing a custom station preserves other selections and protects built-in stations', () => {
  const custom = createCustomStation({ id: 'angin-06', name: 'Timur', lat: -7.78, lng: 110.41 });
  const other = createCustomStation({ id: 'angin-07', name: 'Barat', lat: -7.79, lng: 110.4 });
  const model = { stations: [...createStations(), custom, other], selected: 6, history: [{ id: custom.id }, { id: other.id }] };
  const next = removeCustomStation(model, custom.id);
  assert.equal(next.stations[next.selected].id, other.id);
  assert.equal(next.selected, 5);
  assert.deepEqual(next.history, [{ id: other.id }]);
  assert.equal(removeCustomStation(model, 'ANGIN-01'), model);
  assert.equal(removeCustomStation(model, 'UNKNOWN'), model);
  assert.equal(removeCustomStation({ ...model, selected: 5 }, custom.id).selected, 0);
  assert.equal(removeCustomStation({ ...model, selected: null }, custom.id).selected, null);
  assert.equal(model.stations.length, 7);
});

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
  assert.match(csv, /-7.782233,110.415517,SIMULASI/);
});

test('calculateStats handles records and empty lists correctly', () => {
  const empty = calculateStats([]);
  assert.equal(empty.maxSpeed, 0);
  assert.equal(empty.avgSpeed, 0);
  assert.equal(empty.dominantDirection, '—');

  const sample = [
    { speed: 10, angle: 0 },
    { speed: 30, angle: 10 },
    { speed: 20, angle: 180 },
  ];
  const stats = calculateStats(sample);
  assert.equal(stats.maxSpeed, 30);
  assert.equal(stats.avgSpeed, 20);
  assert.equal(stats.dominantDirection, 'Utara');
  assert.equal(stats.count, 3);
});

test('updateStationFromTelemetry integrates hardware readings and updates online state', () => {
  const base = createStations()[0];
  const telemetry = {
    stationId: 'angin-01',
    status: 'recent',
    source: 'mqtt',
    windSpeedKmh: 24.5,
    windDirectionDeg: 135,
    receivedAt: 1700000000000,
    ageSeconds: 5,
    lat: -7.7801,
    lon: 110.4199
  };

  const updated = updateStationFromTelemetry(base, telemetry);
  assert.equal(updated.speed, 24.5);
  assert.equal(updated.angle, 135);
  assert.equal(updated.online, true);
  assert.equal(updated.lat, -7.7801);
  assert.equal(updated.lng, 110.4199);
  assert.equal(updated.source, 'mqtt');
  assert.equal(updated.samples[updated.samples.length - 1], 24.5);

  const staleTelemetry = { ...telemetry, status: 'stale' };
  const staleStation = updateStationFromTelemetry(base, staleTelemetry);
  assert.equal(staleStation.online, false);
});

test('missing or invalid GPS returns to the fallback after a previous fix', () => {
  const station = { ...createStations()[0], lat: -7.8, lng: 110.5 };
  for (const gps of [undefined, { fix: false, lat: -7.8, lon: 110.5 }, { fix: true, lat: 0, lon: 0 }, { fix: true, lat: -7.8 }, { fix: true, lat: 91, lon: 110 }]) {
    const updated = updateStationFromTelemetry(station, { gps });
    assert.equal(updated.lat, -7.782233);
    assert.equal(updated.lng, 110.415517);
  }
  const fixed = updateStationFromTelemetry(station, { gps: { fix: true, lat: -7.79, lon: 110.42 } });
  assert.equal(fixed.lat, -7.79);
  assert.equal(fixed.lng, 110.42);
});

test('CSV correctly marks HARDWARE_REAL for mqtt source rows', () => {
  const hardwareRecord = {
    timestamp: 1700000000000,
    id: 'ANGIN-01',
    speed: 24.5,
    angle: 180,
    battery: 100,
    lat: -7.7801,
    lng: 110.4199,
    source: 'mqtt'
  };
  const csv = exportCsv([hardwareRecord]);
  assert.match(csv, /HARDWARE_REAL/);
  assert.match(csv, /24.50,180.0,100,-7.7801,110.4199,HARDWARE_REAL/);
});

test('calculateStats handles multi-direction distribution correctly', () => {
  const records = [
    { speed: 12, angle: 90 },  // Timur
    { speed: 14, angle: 95 },  // Timur
    { speed: 28, angle: 270 }, // Barat
  ];
  const stats = calculateStats(records);
  assert.equal(stats.dominantDirection, 'Timur');
  assert.equal(stats.maxSpeed, 28);
  assert.equal(stats.avgSpeed, (12 + 14 + 28) / 3);
});

test('calculateWindRose produces 8-sector distribution correctly', () => {
  const records = [
    { speed: 10, angle: 0 },   // Utara
    { speed: 20, angle: 0 },   // Utara
    { speed: 15, angle: 90 },  // Timur
    { speed: 25, angle: 180 }, // Selatan
  ];
  const rose = calculateWindRose(records);
  assert.equal(rose.length, 8);
  const utara = rose.find((r) => r.direction === 'Utara');
  assert.equal(utara.count, 2);
  assert.equal(utara.percentage, 50);
  assert.equal(utara.avgSpeed, 15);
});

test('getDeviceHealth reflects online and offline states', () => {
  const onlineStation = { online: true, source: 'mqtt' };
  const offlineStation = { online: false, source: 'mqtt' };

  const onlineHealth = getDeviceHealth(onlineStation);
  assert.equal(onlineHealth.wifiStatus, 'Sangat Baik');
  assert.equal(onlineHealth.as5600Status, 'Normal (Magnet OK)');

  const offlineHealth = getDeviceHealth(offlineStation);
  assert.equal(offlineHealth.wifiStatus, 'Terputus');
  assert.equal(offlineHealth.as5600Status, 'Sensor Offline');
});

test('validateUserLogin handles default admin and stored accounts', () => {
  const adminRes = validateUserLogin('admin', 'bayu0098');
  assert.equal(adminRes.valid, true);
  assert.equal(adminRes.user.role, 'admin');

  const failRes = validateUserLogin('admin', 'wrongpass');
  assert.equal(failRes.valid, false);

  const stored = [{ username: 'adhafa', password: 'secret123', role: 'admin', name: 'Adhafa JP' }];
  const customRes = validateUserLogin('adhafa', 'secret123', stored);
  assert.equal(customRes.valid, true);
  assert.equal(customRes.user.name, 'Adhafa JP');
});
