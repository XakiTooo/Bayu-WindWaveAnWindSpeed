import { createStations } from './simulation.mjs';

export const stationIds = createStations().map(({ id }) => id.toLowerCase());
const speedOffsets = [-3, -5, 3, -2, 5];

export function stationSource(station) {
  if (station.source === 'mqtt') return 'Data MQTT';
  if (station.source === 'derived') return 'Simulasi turunan';
  return 'Simulasi';
}

export function validReading(id, value) {
  if (!value || value.stationId !== id) return null;
  const { windSpeedKmh, windDirectionDeg, receivedAt, gps, lat, lon, lng, rssi, uptime_s, heap_kb, packet_id, is_muted, battery } = value;
  if (!Number.isFinite(windSpeedKmh) || windSpeedKmh < 0 ||
      !Number.isFinite(windDirectionDeg) || windDirectionDeg < 0 || windDirectionDeg >= 360 ||
      !Number.isFinite(receivedAt) || receivedAt <= 0) return null;
  return {
    ...(value.directionProcessing === 'server' && Number.isFinite(value.rawWindDirectionDeg) && value.rawWindDirectionDeg >= 0 && value.rawWindDirectionDeg < 360 ? {
      directionProcessing: 'server', rawWindDirectionDeg: value.rawWindDirectionDeg,
      directionSensorValid: value.directionSensorValid === true,
      directionBackendFresh: value.directionBackendFresh === true,
      ...(value.directionSample && Number.isFinite(value.directionSample.rawDeg) && value.directionSample.rawDeg >= 0 && value.directionSample.rawDeg < 360 && Number.isSafeInteger(value.directionSample.capturedAt) && value.directionSample.samples >= 30 ? {
        directionSample: { rawDeg: value.directionSample.rawDeg, capturedAt: value.directionSample.capturedAt, samples: value.directionSample.samples },
      } : {}),
    } : {}),
    windSpeedKmh,
    windDirectionDeg,
    receivedAt,
    ...(gps ? { gps } : {}),
    ...(typeof lat === 'number' ? { lat } : {}),
    ...(typeof lon === 'number' ? { lon } : {}),
    ...(typeof lng === 'number' ? { lng } : {}),
    ...(Number.isFinite(rssi) ? { rssi } : {}),
    ...(Number.isFinite(uptime_s) ? { uptime_s } : {}),
    ...(Number.isFinite(heap_kb) ? { heap_kb } : {}),
    ...(Number.isFinite(packet_id) ? { packet_id } : {}),
    ...(typeof is_muted === 'boolean' ? { is_muted } : {}),
    ...(Number.isFinite(battery) && battery >= 0 && battery <= 100 ? { battery } : {}),
  };
}

export function displayStations(simulated, readings, now) {
  const referenceId = stationIds.find((id) => readings[id]);
  const reference = readings[referenceId];
  return simulated.map((station, index) => {
    const id = station.id.toLowerCase();
    const live = readings[id];
    const input = live ?? reference;
    if (!input) return station;
    const offset = live ? 0 : speedOffsets[index];
    return {
      ...station,
      source: live ? 'mqtt' : 'derived',
      referenceId: live ? id : referenceId,
      speedOffset: offset,
      speed: Math.max(0, input.windSpeedKmh + offset),
      angle: input.windDirectionDeg,
      updated: input.receivedAt,
      online: now - input.receivedAt <= 30_000,
      battery: null,
      samples: [],
    };
  });
}
