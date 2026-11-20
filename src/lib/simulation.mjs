export const CENTER = [-7.782233, 110.415517]; // Titik cadangan saat GPS belum mendapat lokasi.
export const DEFAULT_SETTINGS = { threshold: 40, batteryThreshold: 20 };
const names = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
export const format = (value) => value.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const direction = (angle) => names[Math.round(((angle % 360) + 360) % 360 / 45) % 8];
export const timeLabel = (timestamp) => new Date(timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' });
export const state = (station, settings) => !station.online ? 'offline' : station.speed >= settings.threshold ? 'alarm' : Number.isFinite(station.battery) && station.battery <= settings.batteryThreshold ? 'warning' : 'normal';
export const stateLabel = (station, settings) => ({ normal: 'Normal', warning: 'Baterai lemah', alarm: 'Alarm angin', offline: 'Data terputus' })[state(station, settings)];
export const stateColor = (station, settings) => ({ normal: '#268fa0', warning: '#d89a3e', alarm: '#d56864', offline: '#96a2ad' })[state(station, settings)];

export function createStations(timestamp = 0) {
  return [
    { id: 'ANGIN-01', name: 'Stasiun IoT (Tiang Utama)', lat: CENTER[0], lng: CENTER[1], base: 0, speed: 0, angle: 0, battery: 100, online: true },
    { id: 'ANGIN-02', name: 'Titik Utara', lat: -7.7580, lng: 110.4085, base: 22.6, speed: 22.6, angle: 210, battery: 72, online: true },
    { id: 'ANGIN-03', name: 'Titik Timur', lat: -7.7610, lng: 110.4135, base: 43.2, speed: 43.2, angle: 248, battery: 63, online: true },
    { id: 'ANGIN-04', name: 'Titik Selatan', lat: -7.7660, lng: 110.4100, base: 14.7, speed: 14.7, angle: 192, battery: 17, online: true },
    { id: 'ANGIN-05', name: 'Titik Barat', lat: -7.7635, lng: 110.4045, base: 16.2, speed: 16.2, angle: 235, battery: 48, online: false },
  ].map((station, index) => ({ ...station, updated: timestamp - (station.online ? 0 : 180000), samples: Array.from({ length: 30 }, (_, j) => Math.max(0, station.base + Math.sin(j * .7 + index) * 3 + Math.cos(j * .31) * 1.5)) }));
}

export function advance(stations, tick, timestamp) {
  return stations.map((station, index) => {
    if (!station.online) return station;
    const speed = Math.max(0, station.base + Math.sin(tick * .32 + index) * 2.1);
    // Retain the accumulated angle so crossing north does not spin the needle backwards.
    const angle = station.angle + Math.sin(tick * .37 + index) * 3;
    return { ...station, speed, angle, updated: timestamp, samples: [...station.samples.slice(1), speed] };
  });
}

export function applyScenario(station, scenario, settings, timestamp) {
  const next = { ...station, online: true, updated: timestamp };
  if (scenario === 'normal') return { ...next, base: 15, speed: 15, battery: 85 };
  if (scenario === 'alarm') return { ...next, base: settings.threshold + 8, speed: settings.threshold + 8 };
  if (scenario === 'battery') return { ...next, base: 16, speed: 16, battery: Math.max(1, settings.batteryThreshold - 5) };
  if (scenario === 'offline') return { ...next, online: false, updated: timestamp - 180000 };
  return station;
}

export function records(stations) {
  return stations.filter((s) => s.online).map((s) => ({ timestamp: s.updated, id: s.id, speed: s.speed, angle: ((s.angle % 360) + 360) % 360, battery: s.battery, lat: s.lat, lng: s.lng }));
}

export function exportCsv(rows) {
  return [
    'timestamp,station_id,speed_kmh,direction_deg,battery_percent,latitude,longitude,data_type',
    ...rows.map((row) => [
      new Date(row.timestamp).toISOString(),
      row.id,
      Number(row.speed).toFixed(2),
      Number(row.angle).toFixed(1),
      row.battery ?? 100,
      row.lat,
      row.lng,
      row.dataType || (row.source === 'mqtt' ? 'HARDWARE_REAL' : 'SIMULASI')
    ].join(','))
  ].join('\n');
}

export function calculateStats(recordsList) {
  if (!recordsList || recordsList.length === 0) {
    return { maxSpeed: 0, avgSpeed: 0, dominantDirection: '—', count: 0 };
  }
  let maxSpeed = 0;
  let totalSpeed = 0;
  const directionCounts = {};

  for (const r of recordsList) {
    const s = Number(r.speed) || 0;
    if (s > maxSpeed) maxSpeed = s;
    totalSpeed += s;
    const dir = direction(r.angle);
    directionCounts[dir] = (directionCounts[dir] || 0) + 1;
  }

  let dominantDirection = '—';
  let highestCount = 0;
  for (const [dir, count] of Object.entries(directionCounts)) {
    if (count > highestCount) {
      highestCount = count;
      dominantDirection = dir;
    }
  }

  return {
    maxSpeed,
    avgSpeed: totalSpeed / recordsList.length,
    dominantDirection,
    count: recordsList.length,
  };
}

export const DIRECTIONS_8 = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];

export function calculateWindRose(recordsList) {
  const distribution = DIRECTIONS_8.map((dir) => ({ direction: dir, count: 0, percentage: 0, avgSpeed: 0, totalSpeed: 0 }));
  if (!recordsList || recordsList.length === 0) return distribution;

  for (const r of recordsList) {
    const dir = direction(r.angle);
    const speed = Number(r.speed) || 0;
    const item = distribution.find((d) => d.direction === dir);
    if (item) {
      item.count += 1;
      item.totalSpeed += speed;
    }
  }

  const total = recordsList.length;
  for (const item of distribution) {
    item.percentage = total > 0 ? (item.count / total) * 100 : 0;
    item.avgSpeed = item.count > 0 ? item.totalSpeed / item.count : 0;
  }

  return distribution;
}

export function getDeviceHealth(station) {
  if (!station) {
    return {
      wifiRssi: -72,
      wifiStatus: 'Baik',
      as5600Status: 'Normal (Magnet OK)',
      espNowLoss: '0.0%',
      uptime: '3j 45m',
      heapKb: 178,
      gpsStatus: 'Lock (Kampus UPN)',
    };
  }
  const isOnline = Boolean(station.online);
  const isMqtt = station.source === 'mqtt';
  const hasGpsFix = station.gpsInfo ? station.gpsInfo.fix : false;
  const sats = station.gpsInfo ? station.gpsInfo.sats : 0;
  return {
    wifiRssi: isOnline ? (isMqtt ? -64 : -70) : -95,
    wifiStatus: !isOnline ? 'Terputus' : (isMqtt ? 'Sangat Baik' : 'Baik'),
    as5600Status: isOnline ? 'Normal (Magnet OK)' : 'Sensor Offline',
    espNowLoss: isOnline ? (isMqtt ? '0.1%' : '0.0%') : '100%',
    uptime: isOnline ? '5j 18m' : '—',
    heapKb: isOnline ? 186 : 0,
    gpsStatus: hasGpsFix ? `Satelit Terkunci (${sats} Sats)` : 'GPS belum terkunci (lokasi cadangan)',
  };
}

export function validateUserLogin(username, password, storedUsers = []) {
  const cleanUser = String(username || '').trim().toLowerCase();
  const cleanPass = String(password || '').trim();

  // Default hardcoded admin (matching hardware gateway password)
  if (cleanUser === 'admin' && cleanPass === 'bayu0098') {
    return { valid: true, user: { username: 'admin', role: 'admin', name: 'Administrator BAYU' } };
  }

  // Check stored registered accounts in localStorage
  const found = storedUsers.find((u) => u.username.toLowerCase() === cleanUser && u.password === cleanPass);
  if (found) {
    return { valid: true, user: { username: found.username, role: found.role || 'user', name: found.name || found.username } };
  }

  return { valid: false, error: 'Username atau password salah.' };
}

export function updateStationFromTelemetry(station, telemetry) {
  if (!station || !telemetry) return station;
  const isRecent = telemetry.status === 'recent';
  const speed = Number.isFinite(telemetry.windSpeedKmh) ? telemetry.windSpeedKmh : (Number.isFinite(telemetry.speed_kmh) ? telemetry.speed_kmh : station.speed);
  const angle = Number.isFinite(telemetry.windDirectionDeg) ? telemetry.windDirectionDeg : (Number.isFinite(telemetry.direction_deg) ? telemetry.direction_deg : station.angle);
  const updated = telemetry.receivedAt || Date.now();
  let lat = station.fallbackLat ?? CENTER[0];
  let lng = station.fallbackLng ?? CENTER[1];
  const validCoordinates = (latitude, longitude) => Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0);
  const hasGpsFix = telemetry.gps && (telemetry.gps.fix === true || telemetry.gps.fix === 'true');
  if (hasGpsFix && validCoordinates(telemetry.gps.lat, telemetry.gps.lon)) {
    lat = telemetry.gps.lat;
    lng = telemetry.gps.lon;
  } else if (!telemetry.gps && validCoordinates(telemetry.lat, telemetry.lng ?? telemetry.lon)) {
    lat = telemetry.lat;
    lng = telemetry.lng ?? telemetry.lon;
  }
  const samples = station.samples ? [...station.samples.slice(1), speed] : [speed];

  return {
    ...station,
    speed,
    angle,
    lat,
    lng,
    updated,
    online: isRecent,
    samples,
    source: telemetry.source || 'mqtt',
    ageSeconds: telemetry.ageSeconds,
    gpsInfo: telemetry.gps,
  };
}
