'use client';

import dynamic from 'next/dynamic';
import { useEffect, useReducer, useRef, useState } from 'react';
import {
  advance,
  applyScenario,
  calculateStats,
  calculateWindRose,
  CENTER,
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
  validateUserLogin,
} from '@/lib/simulation.mjs';
import { createCustomStation, restoreCustomStations, defaultStationDraft, applyStationTelemetry, removeCustomStation } from '@/lib/stations.mjs';

const WindMap = dynamic(() => import('./WindMap'), { ssr: false, loading: () => <div className="map-loading">Memuat peta…</div> });

const initial = {
  stations: createStations().map((s, index) => index === 0 ? { ...s, online: false, updated: 0, samples: [] } : s),
  selected: 0,
  paused: false,
  tick: 0,
  settings: DEFAULT_SETTINGS,
  history: [],
  dataSource: 'live',
  soundAlert: true,
  shareKey: '',
  liveStatus: 'polling',
  user: { username: 'guest', role: 'guest', name: 'Tamu Publik' },
  externalWeather: null,
  telegramConfig: { botToken: '', chatId: '', enabled: false },
};

function reducer(model, action) {
  switch (action.type) {
    case 'initialize': {
      let stations = createStations(action.timestamp);
      if (action.coords && Number.isFinite(action.coords.lat) && Number.isFinite(action.coords.lng)) {
        stations = stations.map((s, idx) => idx === 0 ? { ...s, lat: action.coords.lat, lng: action.coords.lng } : s);
      }
      stations = [...stations, ...(action.customStations || [])];
      if (action.dataSource === 'live') stations = stations.map((s, index) => index === 0 ? { ...s, online: false, updated: 0, samples: [] } : s);
      return {
        ...model,
        stations,
        selected: 0,
        settings: action.settings,
        history: action.dataSource === 'live' ? [] : records(stations.filter((s) => !s.custom)),
        dataSource: action.dataSource || 'simulation',
        soundAlert: action.soundAlert ?? true,
        shareKey: action.shareKey || '',
        user: action.user || { username: 'guest', role: 'guest', name: 'Tamu Publik' },
        telegramConfig: action.telegramConfig || { botToken: '', chatId: '', enabled: false },
      };
    }
    case 'tick': {
      if (model.paused) return model;
      if (model.dataSource === 'live') {
        // Matikan kalkulasi simulasi dummy saat mode Live IoT
        return model;
      }
      const tick = model.tick + 1;
      const stations = advance(model.stations, tick, action.timestamp).map((s, index) => model.stations[index].custom ? model.stations[index] : s);
      return { ...model, stations, tick, history: [...records(stations.filter((s) => !s.custom)), ...model.history].slice(0, 1000) };
    }
    case 'select': return { ...model, selected: action.index };
    case 'pause': return { ...model, paused: !model.paused };
    case 'settings': return { ...model, settings: action.settings };
    case 'toggle_source': {
      const dataSource = action.source;
      try { localStorage.setItem('bayu-datasource', dataSource); } catch {}
      return {
        ...model,
        dataSource,
        selected: dataSource === 'live' ? 0 : null,
        liveStatus: dataSource === 'live' ? 'polling' : 'idle'
      };
    }
    case 'set_live_status': return { ...model, liveStatus: action.status };
    case 'live_tick': {
      const { telemetry } = action;
      const stations = applyStationTelemetry(model.stations, telemetry);
      const targetStation = stations.find((s) => s.id.toLowerCase() === telemetry.stationId?.toLowerCase());
      if (!targetStation) return model;
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
    case 'add_station': return { ...model, stations: [...model.stations, action.station], selected: model.stations.length, dataSource: 'live' };
    case 'remove_station': return removeCustomStation(model, action.id);
    case 'station_unavailable': return { ...model, stations: model.stations.map((s) => s.id === action.id ? { ...s, online: false } : s) };
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
    case 'set_station_coords': {
      const stations = model.stations.map((s, idx) => {
        if (idx === 0 || s.id.toLowerCase() === 'angin-01') {
          return { ...s, lat: action.lat, lng: action.lng };
        }
        return s;
      });
      return { ...model, stations };
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
    plus: <path d="M12 5v14M5 12h14" />,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    mute: <><path d="m11 5-6 4H2v6h3l6 4V5ZM16 9l6 6m0-6-6 6" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>,
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
  const [pendingCommand, setPendingCommand] = useState(null);
  const [commandKey, setCommandKey] = useState('');
  const [buzzerMuted, setBuzzerMuted] = useState({});
  const [stationFormOpen, setStationFormOpen] = useState(false);
  const [stationDraft, setStationDraft] = useState(defaultStationDraft);
  const [stationError, setStationError] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [customLat, setCustomLat] = useState(CENTER[0]);
  const [customLng, setCustomLng] = useState(CENTER[1]);
  const lastSoundRef = useRef(0);
  const lastTelegramRef = useRef(0);

  const { stations, selected, paused, settings, history, dataSource, soundAlert, shareKey, liveStatus, user, externalWeather } = model;
  const displayStations = dataSource === 'live'
    ? stations.filter((s, idx) => idx === 0 || s.custom)
    : stations.filter((s) => !s.custom);

  const selectedIndex = selected === null ? -1 : displayStations.findIndex((s) => s.id === stations[selected]?.id);
  const validSelected = selectedIndex < 0 ? null : selectedIndex;
  const station = validSelected === null ? null : displayStations[validSelected];
  const liveStationIds = stations.filter((s, index) => index === 0 || s.custom).map((s) => s.id).join(',');

  useEffect(() => {
    let saved = DEFAULT_SETTINGS;
    let savedSource = 'live';
    let savedSound = true;
    let savedKey = '';
    let savedUser = { username: 'guest', role: 'guest', name: 'Tamu Publik' };
    let savedTg = { botToken: '', chatId: '', enabled: false };
    let savedCoords = null;
    let savedStations = [];

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
      const crd = JSON.parse(localStorage.getItem('bayu-station-coords') || 'null');
      if (crd && Number.isFinite(crd.lat) && Number.isFinite(crd.lng)) savedCoords = crd;
      savedStations = restoreCustomStations(JSON.parse(localStorage.getItem('bayu-custom-stations') || '[]'));
    } catch {}

    dispatch({
      type: 'initialize',
      timestamp: Date.now(),
      settings: saved,
      coords: savedCoords,
      customStations: savedStations,
      dataSource: savedSource,
      soundAlert: savedSound,
      shareKey: savedKey,
      user: savedUser,
      telegramConfig: savedTg,
    });
    if (savedCoords) {
      setCustomLat(savedCoords.lat);
      setCustomLng(savedCoords.lng);
    }
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
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const statuses = await Promise.all(liveStationIds.split(',').map(async (id) => {
          try {
            const res = await fetch(`/api/check-data?stationId=${encodeURIComponent(id.toLowerCase())}&key=${encodeURIComponent(shareKey)}`, { signal: AbortSignal.timeout(8000) });
            const data = await res.json();
            if (!res.ok || !data || data.error || data.stationId?.toLowerCase() !== id.toLowerCase()) throw new Error('Data unavailable');
            if (active) dispatch({ type: 'live_tick', telemetry: data });
            return data.status;
          } catch {
            if (active) dispatch({ type: 'station_unavailable', id });
            return 'error';
          }
        }));
        if (active) dispatch({ type: 'set_live_status', status: statuses.includes('recent') ? 'recent' : statuses.includes('stale') ? 'stale' : 'error' });
      } finally {
        polling = false;
      }
    };
    poll();
    const interval = setInterval(poll, 3500);
    return () => { active = false; clearInterval(interval); };
  }, [dataSource, shareKey, liveStationIds]);

  useEffect(() => {
    if (!soundAlert) return;
    const isAlarm = displayStations.some((s) => s.online && s.speed >= settings.threshold);
    if (isAlarm && Date.now() - lastSoundRef.current > 12000) {
      lastSoundRef.current = Date.now();
      playWarningBeep();
    }
  }, [displayStations, settings.threshold, soundAlert]);

  // Telegram alert dispatch on alarm
  useEffect(() => {
    if (!telegramEnabled || !telegramToken || !telegramChatId) return;
    const alarm = displayStations.find((s) => s.online && s.speed >= settings.threshold);
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
  }, [displayStations, settings.threshold, telegramEnabled, telegramToken, telegramChatId]);

  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2600); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    function escape(event) {
      if (event.key === 'Escape') {
        dispatch({ type: 'select', index: null });
        setListOpen(false);
        setAuthOpen(false);
        setStationFormOpen(false);
      }
    }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);

  const filtered = displayStations.map((s, index) => ({ ...s, index })).filter((s) => `${s.name} ${s.id}`.toLowerCase().includes(search.toLowerCase()));
  function select(index) { dispatch({ type: 'select', index: stations.findIndex((s) => s.id === displayStations[index]?.id) }); setListOpen(false); setSearch(''); setTab('summary'); }
  function close() { dispatch({ type: 'select', index: null }); setListOpen(false); }

  function openStationForm() {
    if (user.role !== 'admin') {
      setAuthOpen(true);
      setToast('Masuk sebagai admin untuk menambah stasiun.');
      return;
    }
    setStationDraft(defaultStationDraft());
    setStationError('');
    setStationFormOpen(true);
  }

  function addStation(event) {
    event.preventDefault();
    if (user.role !== 'admin') return;
    try {
      const added = createCustomStation(stationDraft, stations);
      const customStations = [...stations.filter((s) => s.custom), added];
      localStorage.setItem('bayu-custom-stations', JSON.stringify(customStations.map(({ id, name, fallbackLat, fallbackLng }) => ({ id, name, lat: fallbackLat, lng: fallbackLng }))));
      localStorage.setItem('bayu-datasource', 'live');
      dispatch({ type: 'add_station', station: added });
      setStationFormOpen(false);
      setListOpen(false);
      setSearch('');
      setTab('summary');
      setToast(`${added.name} ditambahkan. Menunggu data alat.`);
    } catch (error) {
      setStationError(error.message);
    }
  }

  function deleteStation() {
    if (user.role !== 'admin' || !station?.custom || pendingCommand) return;
    if (!window.confirm(`Hapus ${station.name} (${station.id}) dari daftar dan peta di browser ini? Data alat di server tetap tersimpan.`)) return;
    try {
      const remaining = stations.filter((s) => s.custom && s.id !== station.id);
      localStorage.setItem('bayu-custom-stations', JSON.stringify(remaining.map(({ id, name, fallbackLat, fallbackLng }) => ({ id, name, lat: fallbackLat, lng: fallbackLng }))));
      dispatch({ type: 'remove_station', id: station.id });
      setCommandLogs((prev) => prev.filter((entry) => entry.stationId !== station.id));
      setBuzzerMuted((prev) => { const next = { ...prev }; delete next[station.id]; return next; });
      setTab('summary');
      setToast(`${station.name} dihapus dari daftar stasiun.`);
    } catch {
      setToast('Stasiun belum dihapus karena penyimpanan browser tidak tersedia.');
    }
  }

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
    setCommandKey('');
  }

  function detectBrowserLocation() {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setToast('Browser Anda tidak mendukung geolokasi GPS.');
      return;
    }
    setToast('Mendeteksi koordinat GPS perangkat…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setCustomLat(lat);
        setCustomLng(lng);
        dispatch({ type: 'set_station_coords', lat, lng });
        try {
          localStorage.setItem('bayu-station-coords', JSON.stringify({ lat, lng }));
        } catch {}
        setToast(`GPS Terdeteksi: ${lat}, ${lng}`);
      },
      (err) => {
        setToast('Gagal membaca GPS: ' + (err.message || 'Izin lokasi belum diberikan di browser'));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function saveSettings(event) {
    event.preventDefault();
    const nextCoords = { lat: Number(customLat), lng: Number(customLng) };
    if (Number.isFinite(nextCoords.lat) && Number.isFinite(nextCoords.lng)) {
      dispatch({ type: 'set_station_coords', ...nextCoords });
      try {
        localStorage.setItem('bayu-station-coords', JSON.stringify(nextCoords));
      } catch {}
    }

    if (user.role !== 'admin') {
      setToast('Koordinat GPS disimpan. Ambang batas hanya dapat diubah oleh Admin.');
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
    setToast('Pengaturan sistem dan koordinat GPS disimpan.');
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
    if (pendingCommand || dataSource !== 'live') return;
    if (user.role !== 'admin') {
      setToast('Fitur ini memerlukan akses Administrator. Silakan login.');
      setAuthOpen(true);
      return;
    }
    const targetId = station?.id || 'angin-01';
    if (!commandKey.trim()) {
      setToast('Isi kunci perintah sebelum mengirim.');
      document.getElementById('command-secret')?.focus();
      return;
    }
    setPendingCommand(action);
    const label = { calibrate_zero: 'Kalibrasi arah utara', buzzer_mute: 'Senyapkan buzzer', buzzer_unmute: 'Aktifkan buzzer', request_telemetry: 'Perbarui pembacaan' }[action] || action;
    const log = (success, message) => setCommandLogs((prev) => [{ stationId: targetId, label, success, message, time: Date.now() }, ...prev].slice(0, 40));
    setToast(`Mengirim perintah [${action}] ke ${targetId}…`);
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${commandKey.trim()}` },
        body: JSON.stringify({ action, stationId: targetId }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      const success = res.ok && data.success === true;
      log(success, data.error);
      if (success) {
        if (action === 'buzzer_mute' || action === 'buzzer_unmute') setBuzzerMuted((prev) => ({ ...prev, [targetId]: action === 'buzzer_mute' }));
        setToast(data.message || 'Perintah berhasil diproses.');
      } else {
        setToast(data.error || 'Gagal mengirim perintah.');
      }
    } catch {
      log(false, 'Koneksi terputus atau waktu tunggu habis.');
      setToast('Koneksi endpoint downlink gagal.');
    } finally {
      setPendingCommand(null);
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

  const alarmStation = displayStations.find((s) => s.online && s.speed >= settings.threshold);
  const stationHistory = station ? history.filter((r) => r.id === station.id) : history;
  const stationStats = calculateStats(stationHistory);
  const stationWindRose = calculateWindRose(stationHistory);
  const deviceHealth = getDeviceHealth(station);

  return (
    <main className={`map-app ${station && !listOpen ? 'panel-open' : ''} ${paused && dataSource === 'simulation' ? 'paused' : ''}`}>
      <WindMap stations={displayStations} selected={validSelected} settings={settings} onSelect={select} onClear={close} focusRequest={focusRequest} fitRequest={fitRequest} />

      {/* User Auth Pill Button */}
      <button className="user-pill" onClick={() => setAuthOpen(true)} title="Kelola Akun & Akses" aria-label={user.role === 'guest' ? 'Masuk atau daftar akun' : 'Kelola akun'}>
        <Icon name="user" size={14} />
        <span>{user.role === 'guest' ? 'Masuk / Daftar' : user.name.split(' ')[0]}</span>
        <span className={`role-badge ${user.role}`}>{user.role}</span>
      </button>

      {/* Auth Modal */}
      {stationFormOpen && (
        <div className="auth-overlay" onClick={() => setStationFormOpen(false)}>
          <section className="station-dialog" role="dialog" aria-modal="true" aria-labelledby="new-station-title" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Tab') { const fields = Array.from(e.currentTarget.querySelectorAll('button, input')); const first = fields[0], last = fields.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } }}>
            <div className="station-dialog-heading">
              <div><span className="section-eyebrow">JARINGAN PEMANTAUAN</span><h2 id="new-station-title">Tambah stasiun</h2></div>
              <button type="button" className="plain-icon" aria-label="Tutup tambah stasiun" onClick={() => setStationFormOpen(false)}><Icon name="close" size={18} /></button>
            </div>
            <p>Daftarkan alat dan tentukan lokasinya di peta.</p>
            <form onSubmit={addStation} className="station-form">
              <label>Nama stasiun<input autoFocus required maxLength={80} placeholder="Mis. Stasiun Lapangan Timur" value={stationDraft.name} onChange={(e) => setStationDraft({ ...stationDraft, name: e.target.value })} /></label>
              <label>ID stasiun<input required maxLength={64} pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" placeholder="Mis. ANGIN-06" value={stationDraft.id} onChange={(e) => setStationDraft({ ...stationDraft, id: e.target.value })} /><small>Samakan dengan ID pada alat. Setiap stasiun harus punya ID unik.</small></label>
              <fieldset><legend>Koordinat cadangan</legend><div className="coordinate-fields">
                <label>Latitude<input required type="number" step="any" min="-90" max="90" value={stationDraft.lat} onChange={(e) => setStationDraft({ ...stationDraft, lat: e.target.value })} /></label>
                <label>Longitude<input required type="number" step="any" min="-180" max="180" value={stationDraft.lng} onChange={(e) => setStationDraft({ ...stationDraft, lng: e.target.value })} /></label>
              </div><small>Dipakai saat GPS alat belum mendapat lokasi.</small></fieldset>
              <p className="station-storage-note">Daftar tersimpan di browser ini. Pembacaan muncul setelah alat terhubung dan mengirim data.</p>
              {stationError && <p className="station-form-error" role="alert">{stationError}</p>}
              <div className="station-form-actions"><button type="button" onClick={() => setStationFormOpen(false)}>Batal</button><button type="submit" className="primary-button"><Icon name="plus" size={16} />Tambah stasiun</button></div>
            </form>
          </section>
        </div>
      )}
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
        <button className="plain-icon add-station-shortcut" aria-label="Tambah stasiun" title="Tambah stasiun" onClick={openStationForm}><Icon name="plus" size={19} /></button>
      </div>

      {!station && !listOpen && (
        <div className="location-chip">
          <button onClick={() => setListOpen(true)}>
            {dataSource === 'live' ? 'Jaringan stasiun' : 'Babarsari'} <span>·</span> {displayStations.length} stasiun <span className="chevron">⌄</span>
          </button>
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
            <span>{dataSource === 'live' ? 'Stasiun pemantauan' : 'Stasiun di sekitar Babarsari'}</span>
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
          <button className="add-station-row" onClick={openStationForm}><Icon name="plus" size={17} /><span>Tambah stasiun</span><Icon name="chevron" size={14} /></button>
          <div className="list-footnote">{dataSource === 'live' ? `${displayStations.length} stasiun terdaftar · Pembacaan langsung dari alat` : 'Mode simulasi · Beralih ke Live IoT untuk alat riil'}</div>
        </aside>
      )}

      {station && !listOpen && (
        <aside className="station-panel" aria-label={`Statistik ${station.name}`}>
          <div className="panel-top">
            <div>
              <span className="station-code">{station.id}</span>
              <h1>{station.name}</h1>
              <p>{dataSource === 'live' ? 'Stasiun pemantauan angin' : 'Babarsari, Yogyakarta'}</p>
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
                : !station.updated ? 'Menunggu data alat' : 'Data terakhir · ' + (clock ? Math.max(1, Math.floor((clock - station.updated) / 60000)) : 3) + ' menit lalu'}
            </span>
          </div>

          <div className="panel-actions">
            <button onClick={() => setFocusRequest((v) => v + 1)}><Icon name="locate" size={17} />Fokus lokasi</button>
            <button onClick={download}><Icon name="download" size={17} />Unduh CSV</button>
            {station.custom && user.role === 'admin' && <button className="delete-station-btn" aria-label="Hapus stasiun" title="Hapus stasiun" disabled={Boolean(pendingCommand)} onClick={deleteStation}><Icon name="trash" size={17} />Hapus</button>}
          </div>

          <nav className="detail-tabs" aria-label="Detail stasiun">
            {[
              ['summary', 'Ringkasan'],
              ['history', 'Riwayat'],
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
                    <div className="health-item">
                      <small>Status GPS</small>
                      <b>{deviceHealth.gpsStatus}</b>
                    </div>
                  </div>
                </div>

                <dl className="device-details">
                  <div><dt>Baterai luar</dt><dd>{Number.isFinite(station.battery) ? <><span className="battery-icon"><i style={{ width: `${station.battery}%`, background: station.battery <= settings.batteryThreshold ? '#cb9227' : '#39826d' }} /></span>{station.battery}%</> : 'Belum tersedia'}</dd></div>
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
                <div className="control-heading"><div><span className="section-eyebrow">AKSES PERANGKAT</span><h2>Kontrol stasiun</h2></div><span className={`connection-pill ${dataSource === 'live' && station.online ? 'connected' : ''}`}><i />{dataSource === 'simulation' ? 'Simulasi' : station.online ? 'Terhubung' : 'Offline'}</span></div>
                <p className="control-intro">Kelola sensor dan alarm pada {station.id}.</p>
                {dataSource === 'simulation' ? <div className="control-notice">Beralih ke Live IoT untuk mengirim perintah ke alat.</div> : user.role !== 'admin' ? <div className="control-notice"><span>Kontrol alat memerlukan akses admin.</span><button onClick={() => setAuthOpen(true)}>Masuk<Icon name="chevron" size={13} /></button></div> : <label className="command-key-label" htmlFor="command-secret">Kunci perintah<input id="command-secret" type="password" autoComplete="off" placeholder="Masukkan kunci akses alat" value={commandKey} onChange={(e) => setCommandKey(e.target.value)} /><small>Hanya dipakai selama halaman ini terbuka.</small></label>}
                <div className="command-actions" aria-busy={Boolean(pendingCommand)}>
                  {[
                    { action: 'calibrate_zero', icon: 'locate', label: 'Kalibrasi arah utara', description: 'Arahkan bilah ke utara, lalu klik untuk menyimpan 0°.' },
                    { action: buzzerMuted[station.id] ? 'buzzer_unmute' : 'buzzer_mute', icon: 'mute', label: buzzerMuted[station.id] ? 'Aktifkan buzzer' : 'Senyapkan buzzer', description: buzzerMuted[station.id] ? 'Kirim permintaan untuk menyalakan alarm.' : 'Kirim permintaan untuk mematikan suara alarm.' },
                    { action: 'request_telemetry', icon: 'refresh', label: 'Perbarui pembacaan', description: 'Minta data terbaru dari stasiun.' },
                  ].map((item) => <button key={item.action} type="button" className="command-btn" disabled={user.role !== 'admin' || dataSource !== 'live' || Boolean(pendingCommand)} onClick={() => sendDownlink(item.action)}><span className="command-icon"><Icon name={item.icon} size={19} /></span><span className="command-copy"><b>{item.label}</b><small>{pendingCommand === item.action ? 'Mengirim perintah…' : item.description}</small></span>{pendingCommand === item.action ? <span className="command-spinner" /> : <Icon name="chevron" size={15} />}</button>)}
                </div>
                <p className="command-caption">Arahkan bilah ke utara sebelum mengirim. Web menunggu konfirmasi dari ESP.</p>
                <div className="command-history-heading"><h3>Aktivitas perintah</h3><span>Sesi ini</span></div>
                <div className="command-log" role="log" aria-label="Aktivitas perintah stasiun" aria-live="polite">
                  {commandLogs.some((entry) => entry.stationId === station.id) ? commandLogs.filter((entry) => entry.stationId === station.id).slice(0, 10).map((entry, i) => <div className="command-entry" key={`${entry.time}-${i}`}><i className={entry.success ? 'queued' : 'failed'} /><div><b>{entry.label}</b><small>{entry.success ? entry.label === 'Kalibrasi arah utara' ? 'Dikonfirmasi ESP' : 'Masuk antrean' : entry.message || 'Gagal dikirim'}</small></div><time>{timeLabel(entry.time)}</time></div>) : <div className="command-empty"><Icon name="radio" size={22} /><span>Belum ada aktivitas<small>Perintah yang dikirim akan muncul di sini.</small></span></div>}
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
                    Titik Koordinat GPS Stasiun Fisik (ANGIN-01)
                  </h3>
                  <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>
                    Geser pin peta langsung ke lokasi uji Anda sekarang (misal: kosan/rumah/lab).
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <label>Latitude
                      <input type="number" step="0.000001" value={customLat} onChange={(e) => setCustomLat(e.target.value)} placeholder="-7.xxxx" />
                    </label>
                    <label>Longitude
                      <input type="number" step="0.000001" value={customLng} onChange={(e) => setCustomLng(e.target.value)} placeholder="110.xxxx" />
                    </label>
                  </div>
                  <button type="button" className="remote-btn" style={{ width: '100%', margin: '8px 0 14px 0', background: '#0284c7', color: '#ffffff' }} onClick={detectBrowserLocation}>
                    📍 Ambil GPS Perangkat Saya Saat Ini (Browser GPS)
                  </button>

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
              {dataSource === 'live' ? station.source === 'mqtt' ? 'Pembacaan diterima langsung dari alat. Lokasi mengikuti GPS atau koordinat cadangan.' : 'Menunggu pembacaan pertama dari alat. Peta menampilkan koordinat cadangan.' : 'Data dan posisi stasiun adalah simulasi.'}
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
