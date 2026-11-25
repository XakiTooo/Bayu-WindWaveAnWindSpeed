'use client';

import { useEffect, useRef, useState } from 'react';

const devices = {
  sender: { title: 'Pengirim luar', description: 'Hall effect, AS5600, GPS, dan pengiriman MQTT.', filename: 'BAYU_Pengirim_Web.ino', libraries: 'ArduinoJson 7.x dan TinyGPSPlus' },
  receiver: { title: 'Penerima dalam', description: 'LCD, LED, buzzer, dan penerimaan data MQTT.', filename: 'BAYU_Penerima_Web.ino', libraries: 'ArduinoJson 7.x dan LiquidCrystal I2C' },
};

export default function StationSetupDialog({ station, online, onClose }) {
  const [role, setRole] = useState('sender');
  const [network, setNetwork] = useState({ wifiSsid: '', wifiPassword: '', mqttUsername: '', mqttPassword: '' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const closeButton = useRef(null);
  const pending = useRef(null);
  const device = devices[role];

  useEffect(() => {
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    function escape(event) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', escape);
    return () => {
      pending.current?.abort();
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', escape);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  function updateNetwork(key, value) {
    setNetwork((current) => ({ ...current, [key]: value }));
    setCode(''); setCopied(false); setError('');
  }

  async function prepare(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setCode(''); setCopied(false);
    const controller = new AbortController();
    pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`/api/stations/${encodeURIComponent(station.id.toLowerCase())}/firmware`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, ...network }), signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        let message = `Kode belum tersedia (HTTP ${response.status}).`;
        try { message = JSON.parse(text).error || message; } catch {}
        throw new Error(message);
      }
      if (!text.includes('void setup()') || !text.includes('void loop()')) throw new Error('Kode dari server belum lengkap.');
      if (!controller.signal.aborted) setCode(text);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
      else setError('Waktu tunggu habis. Silakan buat kode lagi.');
    } finally {
      clearTimeout(timer);
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = device.filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); }
    catch { setError('Penyalinan diblokir browser. Gunakan Unduh .ino atau salin dari pratinjau kode.'); }
  }

  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    const fields = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), summary, textarea')].filter((element) => element.getClientRects().length);
    const first = fields[0], last = fields.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  return <div className="auth-overlay setup-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title" onKeyDown={trapFocus}>
      <header className="setup-header">
        <div><p className="setup-station-name">{station.name}</p><h2 id="setup-title">Hubungkan alat ke BAYU</h2></div>
        <button ref={closeButton} type="button" className="plain-icon" aria-label="Tutup panduan alat" onClick={onClose}>✕</button>
      </header>
      <div className={`setup-connection ${online ? 'connected' : ''}`} role="status"><i /><span>{online ? 'Data alat sudah diterima' : 'Menunggu data pertama dari alat'}</span><code>{station.id.toLowerCase()}</code></div>
      <form onSubmit={prepare}>
        <fieldset className="setup-device-options" disabled={busy}>
          <legend>Pilih ESP yang akan diprogram</legend>
          {Object.entries(devices).map(([key, value]) => <button key={key} type="button" aria-pressed={role === key} className={role === key ? 'selected' : ''} onClick={() => { setRole(key); setCode(''); setCopied(false); setError(''); }}><b>{value.title}</b><span>{value.description}</span></button>)}
        </fieldset>
        <fieldset className="setup-network" disabled={busy}>
          <legend>Koneksi alat</legend>
          <p>Kosongkan isian yang ingin dilengkapi nanti di Arduino IDE.</p>
          <div className="setup-field-grid">
            <label>Nama Wi-Fi 2,4 GHz<input value={network.wifiSsid} maxLength={32} autoComplete="off" placeholder="Wi-Fi tempat alat dipasang" onChange={(e) => updateNetwork('wifiSsid', e.target.value)} /></label>
            <label>Password Wi-Fi<input type="password" autoComplete="new-password" value={network.wifiPassword} maxLength={128} placeholder="Password jaringan" onChange={(e) => updateNetwork('wifiPassword', e.target.value)} /></label>
          </div>
          <details className="setup-mqtt"><summary>Kredensial MQTT alat</summary><p>Gunakan akun perangkat dari pengelola BAYU. Broker dan topik stasiun sudah disiapkan dalam kode.</p>
            <div className="setup-field-grid">
              <label>Username MQTT<input value={network.mqttUsername} maxLength={256} autoComplete="off" onChange={(e) => updateNetwork('mqttUsername', e.target.value)} /></label>
              <label>Password MQTT<input type="password" value={network.mqttPassword} maxLength={256} autoComplete="new-password" onChange={(e) => updateNetwork('mqttPassword', e.target.value)} /></label>
            </div>
          </details>
        </fieldset>
        {error && <p className="setup-error" role="alert">{error}</p>}
        <button className="primary-button setup-generate" type="submit" disabled={busy}>{busy ? 'Menyiapkan sketch…' : code ? 'Buat ulang kode lengkap' : 'Buat kode lengkap ESP32'}</button>
      </form>
      {code && <section className="setup-result" aria-label="Sketch siap digunakan" aria-live="polite">
        <div className="setup-result-heading"><div><b>Sketch {device.title.toLowerCase()} siap</b><p>Sudah mencakup pembacaan alat, koneksi TLS, dan komunikasi MQTT.</p></div></div>
        <div className="setup-download-actions"><button className="primary-button" onClick={download}>Unduh .ino lengkap</button><button className="setup-copy" onClick={copy}>{copied ? 'Kode tersalin' : 'Salin seluruh kode'}</button></div>
        <details className="setup-code-preview"><summary>Lihat kode lengkap</summary><textarea aria-label="Kode Arduino lengkap" readOnly spellCheck={false} value={code} /></details>
        <ol className="setup-upload-guide"><li>Buka <strong>{device.filename}</strong> di Arduino IDE.</li><li>Pilih <strong>ESP32 Dev Module</strong>, lalu install {device.libraries}.</li><li>Lengkapi isian <code>YOUR_…</code> jika masih ada, pilih port ESP, lalu upload.</li><li>Buka Serial Monitor pada <strong>115200 baud</strong>. Status di atas berubah setelah telemetri masuk.</li></ol>
      </section>}
      <footer className="setup-footer"><span>Kode dan pengaturan terpisah untuk setiap pasangan alat.</span><button type="button" className="setup-copy" onClick={onClose}>Selesai</button></footer>
    </section>
  </div>;
}
