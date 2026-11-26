import { CENTER, createStations, updateStationFromTelemetry } from './simulation.mjs';

export function createCustomStation(input, existing = []) {
  const id = String(input.id || '').trim().toUpperCase();
  const name = String(input.name || '').trim();
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(id) || id.length > 64) {
    throw new Error('ID hanya boleh berisi huruf, angka, dan tanda hubung.');
  }
  if ([...createStations(), ...existing].some((station) => station.id.toUpperCase() === id)) {
    throw new Error('ID stasiun sudah digunakan. Pilih ID lain.');
  }
  if (!name || name.length > 80) throw new Error('Isi nama stasiun, maksimal 80 karakter.');
  const lat = input.lat === '' ? NaN : Number(input.lat);
  const lng = input.lng === '' ? NaN : Number(input.lng);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
    throw new Error('Latitude harus antara -90 dan 90, longitude antara -180 dan 180.');
  }
  return { id, name, lat, lng, fallbackLat: lat, fallbackLng: lng, custom: true,
    base: 0, speed: 0, angle: 0, online: false, updated: 0, samples: [] };
}

export function restoreCustomStations(value) {
  const stations = [];
  if (!Array.isArray(value)) return stations;
  for (const item of value) {
    try { stations.push(createCustomStation(item, stations)); } catch {}
  }
  return stations;
}

export const defaultStationDraft = () => ({ id: '', name: '', lat: CENTER[0], lng: CENTER[1] });

export function applyStationTelemetry(stations, telemetry) {
  return stations.map((station) => station.id.toLowerCase() === telemetry.stationId?.toLowerCase()
    ? updateStationFromTelemetry(station, telemetry) : station);
}

export function removeCustomStation(model, id) {
  if (!model.stations.some((station) => station.id === id && station.custom)) return model;
  const selectedId = model.stations[model.selected]?.id;
  const stations = model.stations.filter((station) => station.id !== id);
  const index = stations.findIndex((station) => station.id === selectedId);
  return { ...model, stations, selected: model.selected === null ? null : index < 0 ? 0 : index,
    history: model.history.filter((record) => record.id !== id) };
}
