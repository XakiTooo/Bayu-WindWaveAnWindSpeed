'use client';

import dynamic from 'next/dynamic';
import { useEffect, useReducer, useState } from 'react';
import { advance, applyScenario, createStations, DEFAULT_SETTINGS, direction, exportCsv, format, records, state, stateLabel, timeLabel } from '@/lib/simulation.mjs';

const WindMap = dynamic(() => import('./WindMap'), { ssr: false, loading: () => <div className="map-loading">Memuat peta…</div> });
const initial = { stations: createStations(), selected: null, paused: false, tick: 0, settings: DEFAULT_SETTINGS, history: [] };
function reducer(model, action) {
  switch (action.type) {
    case 'initialize': { const stations = createStations(action.timestamp); return { ...model, stations, settings: action.settings, history: records(stations) }; }
    case 'tick': {
      if (model.paused) return model;
      const tick = model.tick + 1, stations = advance(model.stations, tick, action.timestamp);
      return { ...model, stations, tick, history: [...records(stations), ...model.history].slice(0, 1000) };
    }
    case 'select': return { ...model, selected: action.index };
    case 'pause': return { ...model, paused: !model.paused };
    case 'settings': return { ...model, settings: action.settings };
    case 'scenario': return model.selected === null ? model : { ...model, stations: model.stations.map((s, index) => index === model.selected ? applyScenario(s, action.scenario, model.settings, action.timestamp) : s) };
    default: return model;
  }
}
function Icon({ name, size = 20 }) {
  const paths = { search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>, close: <path d="m6 6 12 12M18 6 6 18" />, menu: <path d="M4 6h16M4 12h16M4 18h16" />, locate: <><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.5" /><path d="M12 2v4m0 12v4M2 12h4m12 0h4" /></>, download: <><path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4" /></>, pause: <path d="M8 5v14M16 5v14" />, play: <path d="m8 4 12 8-12 8Z" />, wind: <><path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h6a3 3 0 1 1-3 3" /></> };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Status({ station, settings }) { return <span className={`status ${state(station, settings)}`}><i />{stateLabel(station, settings)}</span>; }
const degrees = (angle) => Math.round(((angle % 360) + 360) % 360);

export default function MapDashboard() {
  const [model, dispatch] = useReducer(reducer, initial);
  const [search, setSearch] = useState(''), [listOpen, setListOpen] = useState(false), [tab, setTab] = useState('summary');
  const [clock, setClock] = useState(null), [toast, setToast] = useState('');
  const [focusRequest, setFocusRequest] = useState(0), [fitRequest, setFitRequest] = useState(0);
  const [threshold, setThreshold] = useState(40), [batteryThreshold, setBatteryThreshold] = useState(20);
  const { stations, selected, paused, settings, history } = model;
  const station = selected === null ? null : stations[selected];
  useEffect(() => {
    let saved = DEFAULT_SETTINGS;
    try { const value = JSON.parse(localStorage.getItem('bayu-settings') || 'null'); if (value && Number.isFinite(value.threshold) && value.threshold >= 1 && value.threshold <= 120 && Number.isFinite(value.batteryThreshold) && value.batteryThreshold >= 1 && value.batteryThreshold <= 50) saved = value; } catch {}
    dispatch({ type: 'initialize', timestamp: Date.now(), settings: saved });
    setThreshold(saved.threshold); setBatteryThreshold(saved.batteryThreshold); setClock(Date.now());
    const simulation = setInterval(() => dispatch({ type: 'tick', timestamp: Date.now() }), 4000), timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { clearInterval(simulation); clearInterval(timer); };
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2600); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { function escape(event) { if (event.key === 'Escape') { dispatch({ type: 'select', index: null }); setListOpen(false); } } window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, []);
  const filtered = stations.map((s, index) => ({ ...s, index })).filter((s) => `${s.name} ${s.id}`.toLowerCase().includes(search.toLowerCase()));
  function select(index) { dispatch({ type: 'select', index }); setListOpen(false); setSearch(''); setTab('summary'); }
  function close() { dispatch({ type: 'select', index: null }); setListOpen(false); }
  function save(event) { event.preventDefault(); const next = { threshold: Number(threshold), batteryThreshold: Number(batteryThreshold) }; dispatch({ type: 'settings', settings: next }); try { localStorage.setItem('bayu-settings', JSON.stringify(next)); } catch {} setToast('Pengaturan simulasi disimpan.'); }
  function download() { const rows = station ? history.filter((r) => r.id === station.id) : history; const url = URL.createObjectURL(new Blob([exportCsv(rows)], { type: 'text/csv;charset=utf-8;' })); const a = document.createElement('a'); a.href = url; a.download = `bayu-${station?.id || 'semua'}-simulasi.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setToast('CSV simulasi diunduh.'); }

  return <main className={`map-app ${station && !listOpen ? 'panel-open' : ''} ${paused ? 'paused' : ''}`}>
    <WindMap stations={stations} selected={selected} settings={settings} onSelect={select} onClear={close} focusRequest={focusRequest} fitRequest={fitRequest} />
    <div className="map-search"><button className="brand-button" onClick={() => { close(); setFitRequest((v) => v + 1); }} aria-label="BAYU, tampilkan semua stasiun"><Icon name="wind" size={25} /></button><div className="search-field"><label htmlFor="station-search" className="sr-only">Cari stasiun</label><input id="station-search" placeholder="Cari stasiun angin" autoComplete="off" value={search} onFocus={() => setListOpen(true)} onChange={(event) => { setSearch(event.target.value); setListOpen(true); }} /></div><button className="plain-icon" aria-label={listOpen ? 'Tutup daftar stasiun' : 'Buka daftar stasiun'} onClick={() => setListOpen((value) => !value)}><Icon name={listOpen ? 'close' : 'search'} /></button></div>
    {!station && !listOpen && <div className="location-chip"><button onClick={() => setListOpen(true)}>Babarsari <span>·</span> 5 stasiun <span className="chevron">⌄</span></button></div>}
    <div className="simulation-control"><span><i />Data dummy</span><button aria-label={paused ? 'Lanjutkan simulasi' : 'Jeda simulasi'} title={paused ? 'Lanjutkan simulasi' : 'Jeda simulasi'} onClick={() => dispatch({ type: 'pause' })}><Icon name={paused ? 'play' : 'pause'} size={15} /></button></div>

    {listOpen && <aside className="station-list" aria-label="Daftar stasiun"><div className="list-heading"><span>Stasiun di sekitar Babarsari</span><small>{filtered.length} hasil</small></div>{filtered.map((s) => <button className="station-result" key={s.id} onClick={() => select(s.index)}><span className={`station-dot ${state(s, settings)}`}>↑</span><span className="result-text"><b>{s.name}</b><small>{s.id} · {stateLabel(s, settings)}</small></span><span className="result-speed">{s.online ? format(s.speed) : '—'}<small>km/jam</small></span></button>)}{!filtered.length && <p className="no-results">Stasiun tidak ditemukan.</p>}<div className="list-footnote">5 titik simulasi · Belum terhubung ke alat</div></aside>}

    {station && !listOpen && <aside className="station-panel" aria-label={`Statistik ${station.name}`}><div className="panel-top"><div><span className="station-code">{station.id}</span><h1>{station.name}</h1><p>Babarsari, Yogyakarta</p></div><button className="plain-icon" onClick={close} aria-label="Tutup statistik"><Icon name="close" /></button></div><div className="station-state"><Status station={station} settings={settings} /><span>{station.online ? paused ? 'Dijeda' : 'Diperbarui ' + (clock ? timeLabel(station.updated) : '—') : 'Data terakhir · ' + (clock ? Math.max(1, Math.floor((clock - station.updated) / 60000)) : 3) + ' menit lalu'}</span></div><div className="panel-actions"><button onClick={() => setFocusRequest((v) => v + 1)}><Icon name="locate" size={17} />Fokus lokasi</button><button onClick={download}><Icon name="download" size={17} />Unduh CSV</button></div><nav className="detail-tabs" aria-label="Detail stasiun">{[['summary', 'Ringkasan'], ['history', 'Riwayat'], ['settings', 'Pengaturan']].map(([id, title]) => <button className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} key={id} onClick={() => setTab(id)}>{title}</button>)}</nav>
      <div className="panel-body">{tab === 'summary' && <><section className="wind-stat"><div className="stat-label">Kecepatan angin{!station.online && <span>Data terakhir</span>}</div><div className="speed-number">{format(station.speed)}<span>km/jam</span></div><div className="speed-secondary">{format(station.speed / 3.6)} m/s <span>·</span> {station.speed >= settings.threshold ? 'Melewati ambang alarm' : 'Di bawah ambang alarm'}</div></section><section className="direction-stat"><div className="compass" role="img" aria-label={`Arah asal angin ${direction(station.angle)}, ${degrees(station.angle)} derajat`}><span className="north">U</span><span className="east">T</span><span className="south">S</span><span className="west">B</span><div className="needle" style={{ transform: `rotate(${station.angle}deg)` }}><svg width="24" height="70" viewBox="0 0 24 70" fill="none"><path d="m12 4-7 20 7-4 7 4-7-20Z" fill="currentColor" /><path d="M12 20v43" stroke="currentColor" strokeWidth="2" /></svg></div><i /></div><div><div className="stat-label">Arah asal angin</div><h2>{direction(station.angle)}</h2><p>{degrees(station.angle)}° dari utara</p></div></section><dl className="device-details"><div><dt>Baterai luar</dt><dd><span className="battery-icon"><i style={{ width: `${station.battery}%`, background: station.battery <= settings.batteryThreshold ? '#cb9227' : '#39826d' }} /></span>{station.battery}%</dd></div><div><dt>Hubungan antar-ESP</dt><dd>{station.online ? 'Terhubung' : 'Terputus'}</dd></div><div><dt>Ambang alarm</dt><dd>{settings.threshold} km/jam</dd></div></dl><section className="history-preview"><div className="chart-heading"><h2>Kecepatan terakhir</h2><span>km/jam</span></div><div className="chart" role="img" aria-label={`30 sampel kecepatan ${station.id}`}>{station.samples.map((v, index) => <span title={`${format(v)} km/jam`} key={index} style={{ height: `${Math.max(3, Math.min(100, v / 60 * 100))}%` }} />)}</div><div className="chart-labels"><span>30 sampel simulasi</span><span>Terbaru</span></div></section><section className="coordinates"><span>Koordinat simulasi</span><p>{station.lat.toFixed(6)}, {station.lng.toFixed(6)}</p></section></>}
      {tab === 'history' && <section className="history-section"><h2>Riwayat pembacaan</h2><p>Selama halaman ini dibuka.</p><table><thead><tr><th>Waktu</th><th>km/jam</th><th>Arah</th></tr></thead><tbody>{history.filter((r) => r.id === station.id).slice(0, 30).map((r, index) => <tr key={`${r.timestamp}-${index}`}><td>{timeLabel(r.timestamp)}</td><td>{format(r.speed)}</td><td>{degrees(r.angle)}°</td></tr>)}</tbody></table>{!history.some((r) => r.id === station.id) && <p>Belum ada pembacaan baru dari stasiun ini.</p>}</section>}
      {tab === 'settings' && <section className="settings-section"><h2>Ambang peringatan</h2><p>Berlaku untuk seluruh titik simulasi.</p><form onSubmit={save}><label>Kecepatan angin (km/jam)<input type="number" min="1" max="120" required value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label><label>Baterai luar (%)<input type="number" min="1" max="50" required value={batteryThreshold} onChange={(event) => setBatteryThreshold(event.target.value)} /></label><button type="submit" className="primary-button">Simpan</button></form><h2 className="scenario-heading">Coba kondisi alat</h2><div className="scenario-options">{[['normal', 'Normal'], ['alarm', 'Angin kencang'], ['battery', 'Baterai lemah'], ['offline', 'Data terputus']].map(([scenario, title]) => <button key={scenario} onClick={() => { dispatch({ type: 'scenario', scenario, timestamp: Date.now() }); setToast(`${station.id}: ${title.toLowerCase()}.`); }}>{title}</button>)}</div></section>}
      <p className="panel-disclosure">Data dan posisi stasiun adalah simulasi.</p></div></aside>}
    <div className="map-key"><span><i className="key-normal" />Normal</span><span><i className="key-warning" />Baterai lemah</span><span><i className="key-alarm" />Alarm angin</span><span><i className="key-offline" />Terputus</span><span className="direction-note">↑ Arah asal angin</span></div><button className="fit-button" onClick={() => setFitRequest((v) => v + 1)} title="Tampilkan semua stasiun" aria-label="Tampilkan semua stasiun"><Icon name="locate" /></button><div className="map-caption">BAYU <span>·</span> Kelompok 53</div><div className={`toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
  </main>;
}
