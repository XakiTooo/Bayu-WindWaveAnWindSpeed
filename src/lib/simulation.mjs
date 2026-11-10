export const CENTER = [-7.7823031, 110.4159049];
export const DEFAULT_SETTINGS = { threshold: 40, batteryThreshold: 20 };
const names = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
export const format = (value) => value.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const direction = (angle) => names[Math.round(((angle % 360) + 360) % 360 / 45) % 8];
export const timeLabel = (timestamp) => new Date(timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' });
export const state = (station, settings) => !station.online ? 'offline' : station.speed >= settings.threshold ? 'alarm' : station.battery <= settings.batteryThreshold ? 'warning' : 'normal';
export const stateLabel = (station, settings) => ({ normal: 'Normal', warning: 'Baterai lemah', alarm: 'Alarm angin', offline: 'Data terputus' })[state(station, settings)];
export const stateColor = (station, settings) => ({ normal: '#268fa0', warning: '#d89a3e', alarm: '#d56864', offline: '#96a2ad' })[state(station, settings)];

export function createStations(timestamp = 0) {
  return [
    { id: 'ANGIN-01', name: 'Titik Kampus', lat: CENTER[0], lng: CENTER[1], base: 18.4, speed: 18.4, angle: 225, battery: 86, online: true },
    { id: 'ANGIN-02', name: 'Titik Utara', lat: -7.7788, lng: 110.4152, base: 22.6, speed: 22.6, angle: 210, battery: 72, online: true },
    { id: 'ANGIN-03', name: 'Titik Timur', lat: -7.7812, lng: 110.4204, base: 43.2, speed: 43.2, angle: 248, battery: 63, online: true },
    { id: 'ANGIN-04', name: 'Titik Selatan', lat: -7.7860, lng: 110.4169, base: 14.7, speed: 14.7, angle: 192, battery: 17, online: true },
    { id: 'ANGIN-05', name: 'Titik Barat', lat: -7.7836, lng: 110.4115, base: 16.2, speed: 16.2, angle: 235, battery: 48, online: false },
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
  return ['timestamp,station_id,speed_kmh,direction_deg,battery_percent,latitude,longitude,data_type', ...rows.map((row) => [new Date(row.timestamp).toISOString(), row.id, row.speed.toFixed(2), row.angle.toFixed(1), row.battery, row.lat, row.lng, 'SIMULASI'].join(','))].join('\n');
}
