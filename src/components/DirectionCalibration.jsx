'use client';
import { useEffect, useState } from 'react';
import { readApiResponse } from '@/lib/api-response.mjs';
const directions = ['Utara', 'Timur', 'Selatan', 'Barat'];
export default function DirectionCalibration({ stationId, enabled, blocked }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const key = `bayu-calibration-${stationId}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key));
      if (saved && saved.session > 0 && Array.isArray(saved.points) && saved.points.length === 4 && Date.now() - saved.at < 14 * 60000) setDraft(saved);
    } catch {}
  }, [key]);
  function store(value) {
    setDraft(value);
    try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch {}
  }
  async function command(operation, point) {
    if (busy || blocked || !enabled) return;
    const session = operation === 'start' ? (crypto.getRandomValues(new Uint32Array(1))[0] || 1) : draft?.session;
    setBusy(operation); setError(''); setDone(false);
    try {
      const response = await fetch('/api/command', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId, action: 'calibrate_four', calibration: { operation, session, ...(point !== undefined ? { point } : {}) } }),
        signal: AbortSignal.timeout(24000),
      });
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.error || 'Kalibrasi belum dikonfirmasi backend.');
      if (operation === 'start') store({ session, points: Array(4).fill(null), at: Date.now() });
      if (operation === 'capture') {
        if (result.result?.session !== session || result.result?.point !== point || !Number.isFinite(result.result?.rawDeg)) throw new Error('Balasan rekaman tidak sesuai. Ulangi rekam posisi.');
        const points = [...draft.points]; points[point] = result.result.rawDeg;
        store({ ...draft, points, at: Date.now() });
      }
      if (operation === 'save' || operation === 'cancel') { store(null); setDone(operation === 'save'); }
    } catch (failure) { setError(failure.name === 'TimeoutError' ? 'Backend belum membalas. Periksa koneksi lalu coba kembali.' : failure.message); }
    finally { setBusy(''); }
  }
  const point = draft ? draft.points.findIndex((value) => value === null) : -1;
  return <section className="direction-calibration" aria-labelledby="calibration-title">
    <div className="calibration-title"><h3 id="calibration-title">Kalibrasi empat arah</h3><span>AS5600</span></div>
    <p>Rekam empat arah secara berurutan, mulai dari Utara. Tentukan arah patokan dengan kompas, lalu tahan sayap saat merekam.</p>
    {!draft ? <button className="primary-button" disabled={!enabled || !!busy || blocked} onClick={() => command('start')}>{busy ? 'Menyiapkan sesi…' : 'Mulai kalibrasi'}</button> : <>
      <ol className="calibration-steps">{directions.map((name, i) => <li key={name} className={draft.points[i] !== null ? 'recorded' : point === i ? 'current' : ''}><b>{i + 1}</b><span>{name}<small>{draft.points[i] !== null ? `Raw ${draft.points[i].toFixed(1)}°` : point === i ? 'Rekam sekarang' : 'Menunggu'}</small></span></li>)}</ol>
      <div className="calibration-instruction" role="status">{busy === 'capture' ? 'Tahan sayap tetap diam. Backend membaca sensor langsung dari MQTT. Tahan sayap tetap diam sekitar 3–6 detik…' : point >= 0 ? `Arahkan sayap ke ${directions[point]}, lalu tekan Rekam posisi.` : 'Empat posisi sudah direkam. Simpan untuk memeriksa dan menerapkan koreksi.'}</div>
      <div className="calibration-buttons">
        {point >= 0 ? <button className="primary-button" disabled={!!busy || blocked || !enabled} onClick={() => command('capture', point)}>{busy === 'capture' ? 'Merekam…' : `Rekam ${directions[point]}`}</button> : <button className="primary-button" disabled={!!busy || blocked || !enabled} onClick={() => command('save')}>{busy === 'save' ? 'Menyimpan…' : 'Simpan kalibrasi'}</button>}
        <button disabled={!!busy || blocked || !enabled} onClick={() => command('cancel')}>Batalkan</button>
      </div>
      {error && <button className="calibration-restart" disabled={!!busy} onClick={() => { store(null); setError(''); }}>Mulai ulang di web</button>}
    </>}
    {error && <p className="calibration-error" role="alert">{error}</p>}
    {done && <p className="calibration-success" role="status">Kalibrasi tersimpan di Firebase. Backend menerapkan koreksi setiap data alat masuk.</p>}
    <small className="calibration-footnote">Sudut mentah setiap titik dipetakan ke 0°, 90°, 180°, dan 270°. Rentang di antaranya dihitung terpisah. Kalibrasi lama tetap aktif selama perekaman. Posisi magnet dan dudukan harus tetap setelah kalibrasi.</small>
  </section>;
}
