'use client';

import dynamic from 'next/dynamic';
import { useEffect, useReducer, useRef, useState } from 'react';
import {
  advance,
  applyScenario,
  calculateStats,
  calculateWindRose,
  createStations,
  DEFAULT_SETTINGS,
  direction,
  exportCsv,
  format,
  getDeviceHealth,
  records,
  state,
  stateLabel,
  timeLabel,
  updateStationFromTelemetry,
  validateUserLogin,
} from '@/lib/simulation.mjs';

const WindMap = dynamic(() => import('./WindMap'), { ssr: false, loading: () => <div className="map-loading">Memuat peta…</div> });

const initial = {
  stations: createStations(),
  selected: null,
  paused: false,
  tick: 0,
  settings: DEFAULT_SETTINGS,
  history: [],
  dataSource: 'simulation',
  soundAlert: true,
  shareKey: '',
  liveStatus: 'idle',
  user: { username: 'guest', role: 'guest', name: 'Tamu Publik' },
  externalWeather: null,
  telegramConfig: { botToken: '', chatId: '', enabled: false },
};

function reducer(model, action) {
  switch (action.type) {
    case 'initialize': {
      const stations = createStations(action.timestamp);
      return {
        ...model,
        stations,
        settings: action.settings,
        history: records(stations),
        dataSource: action.dataSource || 'simulation',
        soundAlert: action.soundAlert ?? true,
        shareKey: action.shareKey || '',
        user: action.user || { username: 'guest', role: 'guest', name: 'Tamu Publik' },
        telegramConfig: action.telegramConfig || { botToken: '', chatId: '', enabled: false },
      };
    }
    case 'tick': {
      if (model.paused) return model;
      const tick = model.tick + 1;
      let stations;
      if (model.dataSource === 'live') {
        stations = model.stations.map((s, index) => {
          if (index === 0 || s.id.toLowerCase() === 'angin-01') return s;
          return advance([s], tick, action.timestamp)[0];
        });
      } else {
        stations = advance(model.stations, tick, action.timestamp);
      }
      return { ...model, stations, tick, history: [...records(stations), ...model.history].slice(0, 1000) };
    }
    case 'select': return { ...model, selected: action.index };
    case 'pause': return { ...model, paused: !model.paused };
    case 'settings': return { ...model, settings: action.settings };
    case 'toggle_source': {
      const dataSource = action.source;
      try { localStorage.setItem('bayu-datasource', dataSource); } catch {}
      return { ...model, dataSource, liveStatus: dataSource === 'live' ? 'polling' : 'idle' };
    }
    case 'set_live_status': return { ...model, liveStatus: action.status };
    case 'live_tick': {
      const { telemetry } = action;
      const stations = model.stations.map((s, index) => {
        if (index === 0 || s.id.toLowerCase() === telemetry.stationId.toLowerCase()) {
          return updateStationFromTelemetry(s, telemetry);
        }
        return s;
      });
      const targetStation = stations[0];
      const liveRecord = {
        timestamp: telemetry.receivedAt || Date.now(),
        id: targetStation.id,
        speed: targetStation.speed,
        angle: ((targetStation.angle % 360) + 360) % 360,
        battery: targetStation.battery ?? 100,
        lat: targetStation.lat,
        lng: targetStation.lng,
        dataType: 'HARDWARE_REAL',
        source: 'mqtt',
      };
      return {
        ...model,
        stations,
        liveStatus: telemetry.status,
        history: [liveRecord, ...model.history].slice(0, 1000),
      };
    }
    case 'set_user': {
      try { localStorage.setItem('bayu-user', JSON.stringify(action.user)); } catch {}
      return { ...model, user: action.user };
    }
    case 'set_weather': return { ...model, externalWeather: action.weather };
    case 'set_telegram': {
      try { localStorage.setItem('bayu-telegram', JSON.stringify(action.config)); } catch {}
      return { ...model, telegramConfig: action.config };
    }
    case 'toggle_sound': {
      const soundAlert = !model.soundAlert;
      try { localStorage.setItem('bayu-sound', JSON.stringify(soundAlert)); } catch {}
      return { ...model, soundAlert };
    }
    case 'set_share_key': {
      try { localStorage.setItem('bayu-sharekey', action.key); } catch {}
      return { ...model, shareKey: action.key };
    }
    case 'scenario': return model.selected === null ? model : { ...model, stations: model.stations.map((s, index) => index === model.selected ? applyScenario(s, action.scenario, model.settings, action.timestamp) : s) };
    default: return model;
  }
}

function Icon({ name, size = 20 }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    locate: <><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.5" /><path d="M12 2v4m0 12v4M2 12h4m12 0h4" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4" /></>,
    pause: <path d="M8 5v14M16 5v14" />,
    play: <path d="m8 4 12 8-12 8Z" />,
    wind: <><path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h6a3 3 0 1 1-3 3" /></>,
    user: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    radio: <><path d="M4.9 19.1A10 10 0 0 1 4 12a10 10 0 0 1 16 0 10 10 0 0 1-.9 7.1" /><circle cx="12" cy="12" r="2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.wind}</svg>;
}

function Status({ station, settings }) { return <span className={`status ${state(station, settings)}`}><i />{stateLabel(station, settings)}</span>; }
const degrees = (angle) => Math.round(((angle % 360) + 360) % 360);

function playWarningBeep() {
  try {
    if (typeof window === 'undefined') return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.32);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.32);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {}
}

export default function MapDashboard() {
  const [model, dispatch] = useReducer(reducer, initial);
  const [search, setSearch] = useState(''), [listOpen, setListOpen] = useState(false), [tab, setTab] = useState('summary');
  const [clock, setClock] = useState(null), [toast, setToast] = useState('');
  const [focusRequest, setFocusRequest] = useState(0), [fitRequest, setFitRequest] = useState(0);
  const [threshold, setThreshold] = useState(40), [batteryThreshold, setBatteryThreshold] = useState(20);
  const [shareKeyInput, setShareKeyInput] = useState('');
  const [dismissedAlarm, setDismissedAlarm] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [commandLogs, setCommandLogs] = useState([]);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const lastSoundRef = useRef(0);
  const lastTelegramRef = useRef(0);

  const { stations, selected, paused, settings, history, dataSource, soundAlert, shareKey, liveStatus, user, externalWeather } = model;
  const station = selected === null ? null : stations[selected];

  useEffect(() => {
    let saved = DEFAULT_SETTINGS;
    let savedSource = 'simulation';
    let savedSound = true;
    let savedKey = '';
    let savedUser = { username: 'guest', role: 'guest', name: 'Tamu Publik' };
    let savedTg = { botToken: '', chatId: '', enabled: false };

    try {
      const val = JSON.parse(localStorage.getItem('bayu-settings') || 'null');
      if (val && Number.isFinite(val.threshold) && val.threshold >= 1 && val.threshold <= 120 && Number.isFinite(val.batteryThreshold) && val.batteryThreshold >= 1 && val.batteryThreshold <= 50) saved = val;
      const src = localStorage.getItem('bayu-datasource');
      if (src === 'live' || src === 'simulation') savedSource = src;
      const snd = JSON.parse(localStorage.getItem('bayu-sound') || 'true');
      savedSound = Boolean(snd);
      const k = localStorage.getItem('bayu-sharekey');
      if (k) savedKey = k;
      const u = JSON.parse(localStorage.getItem('bayu-user') || 'null');
      if (u && u.username) savedUser = u;
      const tg = JSON.parse(localStorage.getItem('bayu-telegram') || 'null');
      if (tg) savedTg = tg;
    } catch {}

    dispatch({
      type: 'initialize',
      timestamp: Date.now(),
      settings: saved,
      dataSource: savedSource,
      soundAlert: savedSound,
      shareKey: savedKey,
      user: savedUser,
      telegramConfig: savedTg,
    });
    setThreshold(saved.threshold);
    setBatteryThreshold(saved.batteryThreshold);
    setShareKeyInput(savedKey);
    setTelegramToken(savedTg.botToken || '');
    setTelegramChatId(savedTg.chatId || '');
    setTelegramEnabled(Boolean(savedTg.enabled));
    setClock(Date.now());

    // Fetch external weather once on load
    fetch('/api/weather')
      .then((res) => res.json())
      .then((data) => { if (data && !data.error) dispatch({ type: 'set_weather', weather: data }); })
      .catch(() => {});

    const simulation = setInterval(() => dispatch({ type: 'tick', timestamp: Date.now() }), 4000);
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { clearInterval(simulation); clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (dataSource !== 'live') return;
    if (!shareKey) {
      dispatch({ type: 'set_live_status', status: 'error' });
      return;
    }
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/check-data?key=${encodeURIComponent(shareKey)}`);
        if (!res.ok) {
          if (active) dispatch({ type: 'set_live_status', status: 'error' });
          return;
        }
        const data = await res.json();
        if (active && data && !data.error) {
          dispatch({ type: 'live_tick', telemetry: data });
        }
      } catch {
        if (active) dispatch({ type: 'set_live_status', status: 'error' });
      }
    };
    poll();
    const interval = setInterval(poll, 3500);
    return () => { active = false; clearInterval(interval); };
  }, [dataSource, shareKey]);

  useEffect(() => {
    if (!soundAlert) return;
    const isAlarm = stations.some((s) => s.online && s.speed >= settings.threshold);
    if (isAlarm && Date.now() - lastSoundRef.current > 12000) {
      lastSoundRef.current = Date.now();
      playWarningBeep();
    }
  }, [stations, settings.threshold, soundAlert]);

  // Telegram alert dispatch on alarm
  useEffect(() => {
    if (!telegramEnabled || !telegramToken || !telegramChatId) return;
    const alarm = stations.find((s) => s.online && s.speed >= settings.threshold);
    if (alarm && Date.now() - lastTelegramRef.current > 60000) {
      lastTelegramRef.current = Date.now();
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: telegramToken,
          chatId: telegramChatId,
          stationId: alarm.id,
          speed: format(alarm.speed),
          threshold: settings.threshold,
        }),
      }).catch(() => {});
    }
  }, [stations, settings.threshold, telegramEnabled, telegramToken, telegramChatId]);

  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2600); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    function escape(event) {
      if (event.key === 'Escape') {
        dispatch({ type: 'select', index: null });
        setListOpen(false);
        setAuthOpen(false);
      }
    }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);

  const filtered = stations.map((s, index) => ({ ...s, index })).filter((s) => `${s.name} ${s.id}`.toLowerCase().includes(search.toLowerCase()));
  function select(index) { dispatch({ type: 'select', index }); setListOpen(false); setSearch(''); setTab('summary'); }
  function close() { dispatch({ type: 'select', index: null }); setListOpen(false); }

  function handleAuthSubmit(event) {
    event.preventDefault();
    let storedUsers = [];
    try { storedUsers = JSON.parse(localStorage.getItem('bayu-stored-users') || '[]'); } catch {}

    if (authMode === 'login') {
      const res = validateUserLogin(authUsername, authPassword, storedUsers);
      if (res.valid) {
        dispatch({ type: 'set_user', user: res.user });
        setToast(`Berhasil masuk sebagai ${res.user.name}.`);
        setAuthOpen(false);
        setAuthPassword('');
      } else {
        setToast(res.error || 'Login gagal.');
      }
    } else {
      if (!authUsername || !authPassword) {
        setToast('Username dan password wajib diisi.');
        return;
      }
      const newUser = {
        username: authUsername.trim().toLowerCase(),
        password: authPassword.trim(),
        name: authName.trim() || authUsername.trim(),
        role: 'admin',
      };
      storedUsers.push(newUser);
      try { localStorage.setItem('bayu-stored-users', JSON.stringify(storedUsers)); } catch {}
      dispatch({ type: 'set_user', user: { username: newUser.username, role: newUser.role, name: newUser.name } });
      setToast(`Akun ${newUser.name} terdaftar & masuk sebagai Admin.`);
      setAuthOpen(false);
      setAuthPassword('');
    }
  }

  function handleLogout() {
    const guestUser = { username: 'guest', role: 'guest', name: 'Tamu Publik' };
    dispatch({ type: 'set_user', user: guestUser });
    setToast('Keluar akun. Sekarang dalam mode Tamu.');
    setAuthOpen(false);
  }

  function saveSettings(event) {
    event.preventDefault();
    if (user.role !== 'admin') {
      setToast('Akses ditolak: Hanya Admin yang dapat mengubah ambang batas.');
      return;
    }
    const next = { threshold: Number(threshold), batteryThreshold: Number(batteryThreshold) };
    dispatch({ type: 'settings', settings: next });
    dispatch({ type: 'set_share_key', key: shareKeyInput });
    const tgConfig = { botToken: telegramToken, chatId: telegramChatId, enabled: telegramEnabled };
    dispatch({ type: 'set_telegram', config: tgConfig });
    try {
      localStorage.setItem('bayu-settings', JSON.stringify(next));
      localStorage.setItem('bayu-sharekey', shareKeyInput);
    } catch {}
    setToast('Pengaturan sistem disimpan.');
  }

  async function testTelegram() {
    if (!telegramToken || !telegramChatId) {
      setToast('Isi Bot Token dan Chat ID terlebih dahulu.');
      return;
    }
    setToast('Mengirim tes pesan ke Telegram…');
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: telegramToken,
          chatId: telegramChatId,
          message: '🔔 *TES KONEKSI TELEGRAM BAYU IoT*\nStatus integrasi Webhook aktif & berhasil!',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setToast('Pesan Telegram berhasil diterima!');
      } else {
        setToast(`Gagal: ${data.error || 'Periksa token/ID'}`);
      }
    } catch {
      setToast('Gagal terhubung ke gateway notifikasi.');
    }
  }

  async function sendDownlink(action) {
    if (user.role !== 'admin') {
      setToast('Fitur ini memerlukan akses Administrator. Silakan login.');
      setAuthOpen(true);
      return;
    }
    const targetId = station?.id || 'angin-01';
    const commandKey = window.prompt('Masukkan kunci perintah stasiun.')?.trim();
    if (!commandKey) return;
    setToast(`Mengirim perintah [${action}] ke ${targetId}…`);
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${commandKey}` },
        body: JSON.stringify({ action, stationId: targetId }),
      });
      const data = await res.json();
      const logLine = `[${new Date().toLocaleTimeString('id-ID')}] ${action} -> ${data.success ? 'MASUK ANTREAN' : 'GAGAL'}`;
      setCommandLogs((prev) => [logLine, ...prev].slice(0, 10));
      if (data.success) {
        setToast(data.message || 'Perintah berhasil diproses.');
      } else {
        setToast(data.error || 'Gagal mengirim perintah.');
      }
    } catch {
      setToast('Koneksi endpoint downlink gagal.');
    }
  }

  function download() {
    const rows = station ? history.filter((r) => r.id === station.id) : history;
    const url = URL.createObjectURL(new Blob([exportCsv(rows)], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `bayu-${station?.id || 'semua'}-${dataSource}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast('CSV riwayat diunduh.');
  }

  const alarmStation = stations.find((s) => s.online && s.speed >= settings.threshold);
  const stationHistory = station ? history.filter((r) => r.id === station.id) : history;
  const stationStats = calculateStats(stationHistory);
  const stationWindRose = calculateWindRose(stationHistory);
  const deviceHealth = getDeviceHealth(station);

  return (
    <main className={`map-app ${station && !listOpen ? 'panel-open' : ''} ${paused && dataSource === 'simulation' ? 'paused' : ''}`}>
      <WindMap stations={stations} selected={selected} settings={settings} onSelect={select} onClear={close} focusRequest={focusRequest} fitRequest={fitRequest} />

      {/* User Auth Pill Button */}
      <button className="user-pill" onClick={() => setAuthOpen(true)} title="Kelola Akun & Akses">
        <Icon name="user" size={14} />
        <span>{user.name.split(' ')[0]}</span>
        <span className={`role-badge ${user.role}`}>{user.role}</span>
      </button>

      {/* Auth Modal */}
      {authOpen && (
        <div className="auth-overlay" onClick={() => setAuthOpen(false)}>
          <div className="auth-card" onClick={(e) => e.stopPropagation()}>
            <div className="auth-header">
              <h2>{user.role === 'admin' ? 'Akun Administrator' : 'Autentikasi Pengguna'}</h2>
              <button className="auth-close" onClick={() => setAuthOpen(false)}>✕</button>
            </div>

            {user.role === 'admin' ? (
              <div>
                <p style={{ fontSize: '13px', color: '#475569', marginBottom: '14px' }}>
                  Anda masuk sebagai <b>{user.name}</b> (Role: Administrator). Anda memiliki izin penuh untuk downlink perintah ESP32, ubah ambang alarm, dan manajemen sistem.
                </p>
                <button type="button" className="auth-btn" style={{ background: '#e2e8f0', color: '#334155' }} onClick={handleLogout}>
                  Keluar Akun (Ke Mode Tamu)
                </button>
              </div>
            ) : (
              <>
                <nav className="auth-nav">
                  <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Masuk</button>
                  <button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>Daftar Akun</button>
                </nav>
                <form className="auth-form" onSubmit={handleAuthSubmit}>
                  {authMode === 'register' && (
                    <label>Nama Lengkap
                      <input type="text" required placeholder="Contoh: Tim Lapangan" value={authName} onChange={(e) => setAuthName(e.target.value)} />
                    </label>
                  )}
                  <label>Username
                    <input type="text" required placeholder="admin atau username Anda" value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} />
                  </label>
                  <label>Password
                    <input type="password" required placeholder="Password / PIN" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
                  </label>
                  <button type="submit" className="auth-btn">
                    {authMode === 'login' ? 'Masuk ke Sistem' : 'Daftarkan Akun'}
                  </button>
                  <div className="auth-hint">
                    💡 <b>Kredensial Bawaan:</b> Gunakan user <code>admin</code> dan password <code>bayu0098</code> untuk akses administrator hardware langsung.
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {alarmStation && !dismissedAlarm && (
        <div className="alert-banner" role="alert">
          <span>⚠️ Alarm: {alarmStation.name} ({alarmStation.id}) {format(alarmStation.speed)} km/jam melewati batas aman!</span>
          <button onClick={() => setDismissedAlarm(true)} aria-label="Tutup peringatan">✕</button>
        </div>
      )}

      <div className="map-search">
        <button className="brand-button" onClick={() => { close(); setFitRequest((v) => v + 1); }} aria-label="BAYU, tampilkan semua stasiun">
          <Icon name="wind" size={25} />
        </button>
        <div className="search-field">
          <label htmlFor="station-search" className="sr-only">Cari stasiun</label>
          <input id="station-search" placeholder="Cari stasiun angin" autoComplete="off" value={search} onFocus={() => setListOpen(true)} onChange={(event) => { setSearch(event.target.value); setListOpen(true); }} />
        </div>
        <button className="plain-icon" aria-label={listOpen ? 'Tutup daftar stasiun' : 'Buka daftar stasiun'} onClick={() => setListOpen((value) => !value)}>
          <Icon name={listOpen ? 'close' : 'search'} />
        </button>
      </div>

      {!station && !listOpen && (
        <div className="location-chip">
          <button onClick={() => setListOpen(true)}>Babarsari <span>·</span> 5 stasiun <span className="chevron">⌄</span></button>
        </div>
      )}

      <div className="simulation-control">
        <div className="source-toggle">
          <button type="button" className={dataSource === 'simulation' ? 'active' : ''} onClick={() => dispatch({ type: 'toggle_source', source: 'simulation' })}>
            Simulasi
          </button>
          <button type="button" className={dataSource === 'live' ? 'active' : ''} onClick={() => dispatch({ type: 'toggle_source', source: 'live' })}>
            Live IoT
          </button>
        </div>
        {dataSource === 'simulation' ? (
          <>
            <span><i />Data dummy</span>
            <button aria-label={paused ? 'Lanjutkan simulasi' : 'Jeda simulasi'} title={paused ? 'Lanjutkan simulasi' : 'Jeda simulasi'} onClick={() => dispatch({ type: 'pause' })}>
              <Icon name={paused ? 'play' : 'pause'} size={15} />
            </button>
          </>
        ) : (
          <div className={`live-badge ${liveStatus}`}>
            <i />
            {liveStatus === 'recent' ? 'Hardware Aktif' : liveStatus === 'stale' ? 'Data Stale' : liveStatus === 'error' ? 'Koneksi Gagal' : 'Polling IoT…'}
          </div>
        )}
      </div>

      {listOpen && (
        <aside className="station-list" aria-label="Daftar stasiun">
          <div className="list-heading">
            <span>Stasiun di sekitar Babarsari</span>
            <small>{filtered.length} hasil</small>
          </div>
          {filtered.map((s) => (
            <button className="station-result" key={s.id} onClick={() => select(s.index)}>
              <span className={`station-dot ${state(s, settings)}`}>↑</span>
              <span className="result-text">
                <b>{s.name}</b>
                <small>{s.id} · {stateLabel(s, settings)} {s.source === 'mqtt' ? '· IoT' : ''}</small>
              </span>
              <span className="result-speed">{s.online ? format(s.speed) : '—'}<small>km/jam</small></span>
            </button>
          ))}
          {!filtered.length && <p className="no-results">Stasiun tidak ditemukan.</p>}
          <div className="list-footnote">{dataSource === 'live' ? 'Stasiun ANGIN-01 terhubung ke telemetri MQTT riil' : '5 titik simulasi · Beralih ke Live IoT untuk alat riil'}</div>
        </aside>
      )}

      {station && !listOpen && (
        <aside className="station-panel" aria-label={`Statistik ${station.name}`}>
          <div className="panel-top">
            <div>
              <span className="station-code">{station.id}</span>
              <h1>{station.name}</h1>
              <p>Babarsari, Yogyakarta</p>
            </div>
            <button className="plain-icon" onClick={close} aria-label="Tutup statistik">
              <Icon name="close" />
            </button>
          </div>

          <div className="station-state">
            <Status station={station} settings={settings} />
            <span>
              {station.online
                ? paused && dataSource === 'simulation'
                  ? 'Dijeda'
                  : 'Diperbarui ' + (clock ? timeLabel(station.updated) : '—')
                : 'Data terakhir · ' + (clock ? Math.max(1, Math.floor((clock - station.updated) / 60000)) : 3) + ' menit lalu'}
            </span>
          </div>

          <div className="panel-actions">
            <button onClick={() => setFocusRequest((v) => v + 1)}><Icon name="locate" size={17} />Fokus lokasi</button>
            <button onClick={download}><Icon name="download" size={17} />Unduh CSV</button>
          </div>

          <nav className="detail-tabs" aria-label="Detail stasiun">
            {[
              ['summary', 'Ringkasan'],
              ['history', 'Riwayat & Mawar'],
              ['control', 'Kontrol Alat'],
              ['settings', 'Pengaturan'],
            ].map(([id, title]) => (
              <button className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} key={id} onClick={() => setTab(id)}>
                {title}
              </button>
            ))}
          </nav>

          <div className="panel-body">
            {tab === 'summary' && (
              <>
                <section className="wind-stat">
                  <div className="stat-label">Kecepatan angin{!station.online && <span>Data terakhir</span>}</div>
                  <div className="speed-number">{format(station.speed)}<span>km/jam</span></div>
                  <div className="speed-secondary">{format(station.speed / 3.6)} m/s <span>·</span> {station.speed >= settings.threshold ? 'Melewati ambang alarm' : 'Di bawah ambang alarm'}</div>
                </section>

                <section className="direction-stat">
                  <div className="compass" role="img" aria-label={`Arah asal angin ${direction(station.angle)}, ${degrees(station.angle)} derajat`}>
                    <span className="north">U</span>
                    <span className="east">T</span>
                    <span className="south">S</span>
                    <span className="west">B</span>
                    <div className="needle" style={{ transform: `rotate(${station.angle}deg)` }}>
                      <svg width="24" height="70" viewBox="0 0 24 70" fill="none">
                        <path d="m12 4-7 20 7-4 7 4-7-20Z" fill="currentColor" />
                        <path d="M12 20v43" stroke="currentColor" strokeWidth="2" />
                      </svg>
                    </div>
                    <i />
                  </div>
                  <div>
                    <div className="stat-label">Arah asal angin</div>
                    <h2>{direction(station.angle)}</h2>
                    <p>{degrees(station.angle)}° dari utara</p>
                  </div>
                </section>

                {/* Weather Comparison Widget */}
                {externalWeather && (
                  <div className="weather-box">
                    <div className="weather-title">
                      <span>Komparasi Prakiraan DIY</span>
                      <small>{externalWeather.location}</small>
                    </div>
                    <div className="weather-content">
                      <div>
                        <div className="weather-main">{format(externalWeather.windSpeedKmh)} <span style={{ fontSize: '12px' }}>km/jam</span></div>
                        <div className="weather-sub">{externalWeather.condition} · {externalWeather.temperature}°C</div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '11px', color: '#134e4a' }}>
                        <div>Selisih Sensor:</div>
                        <b>{Math.abs(station.speed - externalWeather.windSpeedKmh).toFixed(1)} km/jam</b>
                      </div>
                    </div>
                  </div>
                )}

                {/* Device Diagnostics & Health */}
                <div className="health-box">
                  <div className="health-title">
                    <span>Diagnostik Kesehatan Alat</span>
                    <small>{station.online ? 'Kondisi Prima' : 'Perlu Pengecekan'}</small>
                  </div>
                  <div className="health-grid">
                    <div className="health-item">
                      <small>Wi-Fi RSSI</small>
                      <b>{deviceHealth.wifiRssi} dBm ({deviceHealth.wifiStatus})</b>
                    </div>
                    <div className="health-item">
                      <small>Sensor AS5600</small>
                      <b>{deviceHealth.as5600Status}</b>
                    </div>
                    <div className="health-item">
                      <small>ESP-NOW Loss</small>
                      <b>{deviceHealth.espNowLoss}</b>
                    </div>
                    <div className="health-item">
                      <small>Heap ESP32</small>
                      <b>{deviceHealth.heapKb} KB Bebas</b>
                    </div>
                  </div>
                </div>

                <dl className="device-details">
                  <div><dt>Baterai luar</dt><dd><span className="battery-icon"><i style={{ width: `${station.battery}%`, background: station.battery <= settings.batteryThreshold ? '#cb9227' : '#39826d' }} /></span>{station.battery}%</dd></div>
                  <div><dt>Hubungan jaringan</dt><dd>{station.online ? 'Terhubung' : 'Terputus'}</dd></div>
                  <div><dt>Ambang alarm</dt><dd>{settings.threshold} km/jam</dd></div>
                  <div><dt>Sumber telemetri</dt><dd>{station.source === 'mqtt' ? 'MQTT TLS 8883' : 'Simulasi Internal'}</dd></div>
                  {station.ageSeconds !== undefined && (
                    <div><dt>Usia paket data</dt><dd>{station.ageSeconds} dtk lalu</dd></div>
                  )}
                </dl>

                <section className="history-preview">
                  <div className="chart-heading">
                    <h2>Kecepatan terakhir</h2>
                    <span>km/jam</span>
                  </div>
                  <div className="chart" role="img" aria-label={`30 sampel kecepatan ${station.id}`}>
                    {station.samples.map((v, index) => (
                      <span title={`${format(v)} km/jam`} key={index} style={{ height: `${Math.max(3, Math.min(100, (v / 60) * 100))}%` }} />
                    ))}
                  </div>
                  <div className="chart-labels">
                    <span>30 sampel {station.source === 'mqtt' ? 'hardware' : 'simulasi'}</span>
                    <span>Terbaru</span>
                  </div>
                </section>

                <section className="coordinates">
                  <span>Koordinat stasiun</span>
                  <p>{station.lat.toFixed(6)}, {station.lng.toFixed(6)}</p>
                </section>
              </>
            )}

            {tab === 'history' && (
              <section className="history-section">
                <h2>Riwayat & Analitik</h2>
                <p>{station.source === 'mqtt' ? 'Data telemetri langsung dari hardware IoT.' : 'Selama sesi halaman ini dibuka.'}</p>

                <div className="stats-grid">
                  <div className="stat-card">
                    <small>Gust Maks</small>
                    <b>{format(stationStats.maxSpeed)} <span className="unit">km/j</span></b>
                  </div>
                  <div className="stat-card">
                    <small>Rata-rata</small>
                    <b>{format(stationStats.avgSpeed)} <span className="unit">km/j</span></b>
                  </div>
                  <div className="stat-card">
                    <small>Arah Dominan</small>
                    <b>{stationStats.dominantDirection}</b>
                  </div>
                </div>

                {/* Wind Rose (Mawar Angin) Component */}
                <div className="windrose-box">
                  <div className="windrose-title">
                    <span>Diagram Mawar Angin (Wind Rose)</span>
                    <small>{stationHistory.length} sampel</small>
                  </div>
                  <div className="windrose-list">
                    {stationWindRose.map((item) => (
                      <div className="windrose-row" key={item.direction}>
                        <span className="windrose-sector">{item.direction}</span>
                        <div className="windrose-track">
                          <div className="windrose-fill" style={{ width: `${item.percentage}%` }} />
                        </div>
                        <span className="windrose-val">{item.percentage.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                <table>
                  <thead>
                    <tr><th>Waktu</th><th>km/jam</th><th>Arah</th><th>Sumber</th></tr>
                  </thead>
                  <tbody>
                    {stationHistory.slice(0, 30).map((r, index) => (
                      <tr key={`${r.timestamp}-${index}`}>
                        <td>{timeLabel(r.timestamp)}</td>
                        <td>{format(r.speed)}</td>
                        <td>{degrees(r.angle)}°</td>
                        <td>{r.source === 'mqtt' ? 'IoT Real' : 'Simulasi'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!stationHistory.length && <p>Belum ada pembacaan baru dari stasiun ini.</p>}
              </section>
            )}

            {tab === 'control' && (
              <section className="control-box">
                <h3>Kontrol Downlink MQTT (ESP32)</h3>
                <p>Mengirim perintah operasional dua arah ke stasiun <b>{station.id}</b>.</p>

                {user.role !== 'admin' && (
                  <div className="auth-hint" style={{ marginBottom: '12px', background: '#fef3c7', color: '#92400e' }}>
                    🔒 <b>Akses Terbatas:</b> Anda berada dalam mode Tamu. Silakan klik tombol akun di pojok kanan atas dan masuk sebagai Admin untuk mengirim perintah.
                  </div>
                )}

                <button
                  type="button"
                  className="command-btn"
                  disabled={user.role !== 'admin'}
                  onClick={() => sendDownlink('calibrate_zero')}
                >
                  🎯 Kalibrasi Titik Nol (Utara Sensor AS5600)
                </button>

                <button
                  type="button"
                  className="command-btn"
                  disabled={user.role !== 'admin'}
                  onClick={() => sendDownlink('buzzer_mute')}
                >
                  🔇 Mute / Senyapkan Buzzer Alarm Lapangan
                </button>

                <button
                  type="button"
                  className="command-btn"
                  disabled={user.role !== 'admin'}
                  onClick={() => sendDownlink('request_telemetry')}
                >
                  🔄 Minta Paksa Pembaruan Telemetri Sekarang
                </button>

                <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', margin: '14px 0 4px 0' }}>
                  Log Perintah Terkirim
                </h4>
                <div className="command-log">
                  {commandLogs.length ? commandLogs.map((l, i) => <div key={i}>{l}</div>) : 'Belum ada perintah yang dieksekusi.'}
                </div>
              </section>
            )}

            {tab === 'settings' && (
              <section className="settings-section">
                <h2>Ambang Peringatan</h2>
                <p>Berlaku untuk seluruh titik stasiun.</p>
                <form onSubmit={saveSettings}>
                  <label>Kecepatan angin (km/jam)
                    <input type="number" min="1" max="120" required value={threshold} onChange={(event) => setThreshold(event.target.value)} />
                  </label>
                  <label>Baterai luar (%)
                    <input type="number" min="1" max="50" required value={batteryThreshold} onChange={(event) => setBatteryThreshold(event.target.value)} />
                  </label>

                  <div className="toggle-row">
                    <label htmlFor="sound-alert">Alarm Suara Browser</label>
                    <input id="sound-alert" type="checkbox" checked={soundAlert} onChange={() => dispatch({ type: 'toggle_sound' })} />
                  </div>

                  <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', marginTop: '16px', marginBottom: '4px' }}>
                    Notifikasi Telegram Bot
                  </h3>
                  <div className="toggle-row">
                    <label htmlFor="tg-alert">Aktifkan Peringatan Telegram</label>
                    <input id="tg-alert" type="checkbox" checked={telegramEnabled} onChange={(e) => setTelegramEnabled(e.target.checked)} />
                  </div>

                  <label>Bot Token Telegram
                    <input type="text" placeholder="123456:ABC-DEF..." value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} />
                  </label>
                  <label>Chat ID Telegram
                    <input type="text" placeholder="-100... atau ID Pengguna" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} />
                  </label>

                  <button type="button" className="remote-btn" style={{ width: '100%', marginBottom: '14px' }} onClick={testTelegram}>
                    🧪 Tes Kirim Pesan ke Telegram
                  </button>

                  <label>API Key Telemetri Hardware
                    <input type="text" value={shareKeyInput} onChange={(event) => setShareKeyInput(event.target.value)} placeholder="Kunci otorisasi share-key" />
                  </label>

                  <button type="submit" className="primary-button">Simpan Pengaturan</button>
                </form>

                <h2 className="scenario-heading">Coba Kondisi Alat</h2>
                <div className="scenario-options">
                  {[['normal', 'Normal'], ['alarm', 'Angin kencang'], ['battery', 'Baterai lemah'], ['offline', 'Data terputus']].map(([scenario, title]) => (
                    <button key={scenario} onClick={() => { dispatch({ type: 'scenario', scenario, timestamp: Date.now() }); setToast(`${station.id}: ${title.toLowerCase()}.`); }}>
                      {title}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <p className="panel-disclosure">
              {station.source === 'mqtt' ? 'Data diterima dari gateway ESP32 melalui broker EMQX Cloud.' : 'Data dan posisi stasiun adalah simulasi.'}
            </p>
          </div>
        </aside>
      )}

      <div className="map-key">
        <span><i className="key-normal" />Normal</span>
        <span><i className="key-warning" />Baterai lemah</span>
        <span><i className="key-alarm" />Alarm angin</span>
        <span><i className="key-offline" />Terputus</span>
        <span className="direction-note">↑ Arah asal angin</span>
      </div>

      <button className="fit-button" onClick={() => setFitRequest((v) => v + 1)} title="Tampilkan semua stasiun" aria-label="Tampilkan semua stasiun">
        <Icon name="locate" />
      </button>
      <div className="map-caption">BAYU <span>·</span> Kelompok 53</div>
      <div className={`toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
    </main>
  );
}
