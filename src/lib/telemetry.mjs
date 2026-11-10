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
  const { windSpeedKmh, windDirectionDeg, receivedAt } = value;
  if (!Number.isFinite(windSpeedKmh) || windSpeedKmh < 0 ||
      !Number.isFinite(windDirectionDeg) || windDirectionDeg < 0 || windDirectionDeg >= 360 ||
      !Number.isFinite(receivedAt) || receivedAt <= 0) return null;
  return { windSpeedKmh, windDirectionDeg, receivedAt };
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
