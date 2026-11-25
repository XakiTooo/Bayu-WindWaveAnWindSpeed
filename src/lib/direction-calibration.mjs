const wrap = (value) => ((value % 360) + 360) % 360;
export function validateDirectionPoints(points) {
  if (!Array.isArray(points) || points.length !== 4 || points.some((p) => !Number.isFinite(p) || p < 0 || p >= 360)) throw new Error('Empat titik kalibrasi belum lengkap.');
  for (const sign of [1, -1]) {
    const spans = points.map((p, i) => wrap(sign * (points[(i + 1) % 4] - p)));
    if (spans.every((span) => span >= 8 && span <= 172) && Math.abs(spans.reduce((a,b) => a+b,0)-360) < .001) return { points: [...points], sign };
  }
  throw new Error('Urutan empat arah tidak membentuk satu putaran. Ulangi perekaman sesuai arah fisik.');
}
export function correctRawDirection(raw, calibration) {
  if (!Number.isFinite(raw)) throw new Error('Sudut mentah tidak valid.');
  if (!calibration) return wrap(raw);
  const {points,sign} = validateDirectionPoints(calibration.points);
  const position = wrap(sign * (raw - points[0]));
  let start = 0;
  for (let i=0;i<4;i++) {
    const span=wrap(sign*(points[(i+1)%4]-points[i]));
    if (position <= start+span || i===3) return wrap((i+(position-start)/span)*90);
    start+=span;
  }
}
export function calibratedDirection(reading, calibration) {
  return reading.directionProcessing === 'server' && Number.isFinite(reading.rawWindDirectionDeg)
    ? correctRawDirection(reading.rawWindDirectionDeg, calibration) : reading.windDirectionDeg;
}
