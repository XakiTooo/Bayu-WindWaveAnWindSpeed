'use client';

import { useEffect, useRef, useState } from 'react';

export default function StationSetupDialog({ station, online, onClose }) {
  const [network, setNetwork] = useState({ wifiSsid: '', wifiPassword: '', mqttUsername: station.id.toLowerCase(), mqttPassword: '' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const closeButton = useRef(null);
  const pending = useRef(null);
  const filename = "BAYU_Koneksi_MQTT.ino";
  const topic = `bayu/stations/${station.id.toLowerCase()}/telemetry`;

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
        body: JSON.stringify({ kind: 'connection', role: 'sender', ...network }), signal: controller.signal,
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
    anchor.href = url; anchor.download = filename; anchor.click();
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
        <section className="setup-mqtt">
          <h3>Akun MQTT perangkat</h3>
          <p>Gunakan akun khusus stasiun ini. Di EMQX, pengelola perlu mendaftarkan akun dan memberi izin publish ke topik berikut.</p>
          <code>{topic}</code>
          <p>Untuk contoh pengirim ini, batasi izin ke topik di atas. Akun login dashboard terpisah dari akun MQTT.</p>
        </section>
        <fieldset className="setup-network" disabled={busy}>
          <legend>Koneksi alat</legend>
          <p>Kosongkan isian yang ingin dilengkapi nanti di Arduino IDE.</p>
          <div className="setup-field-grid">
            <label>Nama Wi-Fi 2,4 GHz<input value={network.wifiSsid} maxLength={32} autoComplete="off" placeholder="Wi-Fi tempat alat dipasang" onChange={(e) => updateNetwork('wifiSsid', e.target.value)} /></label>
            <label>Password Wi-Fi<input type="password" autoComplete="new-password" value={network.wifiPassword} maxLength={128} placeholder="Password jaringan" onChange={(e) => updateNetwork('wifiPassword', e.target.value)} /></label>
          </div>
          <div className="setup-field-grid">
            <label>Username MQTT<input required value={network.mqttUsername} maxLength={256} autoComplete="off" onChange={(e) => updateNetwork('mqttUsername', e.target.value)} /></label>
            <label>Password MQTT<input required type="password" value={network.mqttPassword} maxLength={256} autoComplete="new-password" onChange={(e) => updateNetwork('mqttPassword', e.target.value)} /></label>
          </div>
          <button type="button" className="setup-copy" onClick={() => {
            const password = Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) => byte.toString(16).padStart(2, '0')).join('');
            updateNetwork('mqttPassword', password);
          }}>Buat password MQTT</button>
          {network.mqttPassword && <button type="button" className="setup-copy" onClick={async () => {
            try { await navigator.clipboard.writeText(network.mqttPassword); }
            catch { setError('Browser tidak mengizinkan penyalinan password.'); }
          }}>Salin password untuk EMQX</button>}
        </fieldset>
        {error && <p className="setup-error" role="alert">{error}</p>}
        <button className="primary-button setup-generate" type="submit" disabled={busy}>{busy ? 'Menyiapkan sketch…' : code ? 'Perbarui contoh koneksi' : 'Buat contoh koneksi ESP32'}</button>
      </form>
      {code && <section className="setup-result" aria-label="Sketch siap digunakan" aria-live="polite">
        <div className="setup-result-heading"><div><b>Contoh koneksi siap</b><p>ID stasiun, broker TLS, kredensial, dan format telemetri sudah terisi. Hubungkan fungsi publishWind dengan pembacaan sensormu.</p></div></div>
        <div className="setup-download-actions"><button className="primary-button" onClick={download}>Unduh .ino</button><button className="setup-copy" onClick={copy}>{copied ? 'Kode tersalin' : 'Salin kode'}</button></div>
        <details className="setup-code-preview"><summary>Lihat kode koneksi</summary><textarea aria-label="Kode koneksi Arduino" readOnly spellCheck={false} value={code} /></details>
        <ol className="setup-upload-guide"><li>Buka <strong>{filename}</strong> di Arduino IDE.</li><li>Pilih <strong>ESP32 Dev Module</strong>, lalu pasang PubSubClient dan ArduinoJson 7.</li><li>Lengkapi isian <code>YOUR_…</code> jika masih ada, pilih port ESP, lalu upload.</li><li>Buka Serial Monitor pada <strong>115200 baud</strong>. Status di atas berubah setelah telemetri masuk.</li></ol>
      </section>}
      <footer className="setup-footer"><span>Simpan kode yang sudah berisi password di perangkatmu sendiri.</span><button type="button" className="setup-copy" onClick={onClose}>Selesai</button></footer>
    </section>
  </div>;
}
