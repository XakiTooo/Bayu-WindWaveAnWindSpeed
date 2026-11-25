export function calibrationPayload(value) {
  if (!value || !['start', 'capture', 'save', 'cancel'].includes(value.operation)
    || !Number.isInteger(value.session) || value.session < 1 || value.session > 0xffffffff
    || (value.operation === 'capture' && (!Number.isInteger(value.point) || value.point < 0 || value.point > 3))) {
    throw new Error('Permintaan kalibrasi tidak valid.');
  }
  return { operation: value.operation, session: value.session,
    ...(value.operation === 'capture' ? { point: value.point } : {}) };
}
