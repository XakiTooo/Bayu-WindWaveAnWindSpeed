'use client';

import dynamic from 'next/dynamic';
import { googleIdToken } from '@/lib/firebase-client';
import { readApiResponse } from '@/lib/api-response.mjs';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import StationSettings from './StationSettings';
import DirectionCalibration from './DirectionCalibration';
import StationSetupDialog from './StationSetupDialog';
import {
  calculateStats,
  calculateWindRose,
  CENTER,
  DEFAULT_SETTINGS,
  direction,
  exportCsv,
  format,
  getDeviceHealth,
  state,
  stateLabel,
  timeLabel,
} from '@/lib/simulation.mjs';
import { createCustomStation, restoreCustomStations, defaultStationDraft, applyStationTelemetry, removeCustomStation } from '@/lib/stations.mjs';

function canManageListedStation(user, station) {
  return Boolean(station?.registered && user.role !== 'guest' &&
    (user.role === 'admin' || station.ownerId === user.username));
}

function trapDialogFocus(event) {
  if (event.key !== 'Tab') return;
  const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
    .filter((element) => element.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

const WindMap = dynamic(() => import('./WindMap'), { ssr: false, loading: () => <div className="map-loading">Memuat peta…</div> });

const initial = {
  stations: [],
  selected: 0,
  settings: DEFAULT_SETTINGS,
  history: [],
  dataSource: 'live',
  soundAlert: true,
  liveStatus: 'polling',
  sessionRevision: 0,
  user: { username: 'guest', role: 'guest', name: 'Tamu Publik' },
  externalWeather: null,
};

function reducer(model, action) {
  switch (action.type) {
    case 'initialize': {
      const stations = [];
      return {
        ...model,
        stations,
        selected: 0,
        settings: action.settings,
        history: [],
        dataSource: 'live',
        soundAlert: action.soundAlert ?? true,
        user: action.user || { username: 'guest', role: 'guest', name: 'Tamu Publik' },
      };
    }
    case 'select': return { ...model, selected: action.index };
    case 'settings': return { ...model, settings: action.settings };
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
        lat: targetStation.lat,
        lng: targetStation.lng,
        dataType: 'HARDWARE_REAL',
        source: 'mqtt',
      };
      return {
        ...model,
        stations,
        liveStatus: telemetry.status,
        history: [liveRecord, ...model.history.filter((row) => row.id !== liveRecord.id || row.timestamp !== liveRecord.timestamp)].slice(0, 1000),
      };
    }
    case 'load_history': {
      const existing = new Map(model.history.map((row) => [`${row.id}:${row.timestamp}`, row]));
      for (const row of action.rows) existing.set(`${row.id}:${row.timestamp}`, row);
      return { ...model, history: [...existing.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 1000) };
    }
    case 'registry': {
      const selectedId = model.stations[model.selected]?.id;
      const stations = action.stations.map((entry) => ({
        base: 0, speed: 0, angle: 0, online: false, updated: 0, samples: [],
        ...entry, id: entry.id.toUpperCase(), fallbackLat: entry.lat, fallbackLng: entry.lng, registered: true, custom: true,
      }));
      const index = stations.findIndex((station) => station.id === selectedId);
      return { ...model, stations, history: [], selected: index < 0 ? null : index };
    }
    case 'station_location': return { ...model, stations: model.stations.map((s) => s.id === action.id ? { ...s, fallbackLat: action.location.lat, fallbackLng: action.location.lng, ...(!s.gpsInfo?.fix ? action.location : {}) } : s) };
    case 'station_settings': return { ...model, stations: model.stations.map((station) => station.id === action.id ? { ...station, settings: action.settings } : station) };
    case 'add_station': return { ...model, stations: [...model.stations, action.station], selected: model.stations.length, dataSource: 'live' };
    case 'remove_station': return removeCustomStation(model, action.id);
    case 'station_unavailable': return { ...model, stations: model.stations.map((s) => s.id === action.id ? { ...s, online: false } : s) };
    case 'refresh_session': {
      if (action.revision !== model.sessionRevision) return model;
      const user = action.authenticated && action.user ? action.user : initial.user;
      return reducer(model, { type: 'set_user', user, sessionCheck: true });
    }
    case 'set_user': {
      if (model.user.username === action.user.username && model.user.role === action.user.role) return { ...model, user: action.user };
      return { ...model, sessionRevision: model.sessionRevision + (action.sessionCheck ? 0 : 1), user: action.user, stations: [], history: [], selected: null };
    }
    case 'set_weather': return { ...model, externalWeather: action.weather };
    case 'toggle_sound': {
      const soundAlert = !model.soundAlert;
      try { localStorage.setItem('bayu-sound', JSON.stringify(soundAlert)); } catch {}
      return { ...model, soundAlert };
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
    default: return model;
  }
}

function Icon({ name, size = 20 }) {
  const paths = {
    settings: <><path d="M10 3h4l.6 2.4 1.2.7 2.4-.7 2 3.4-1.8 1.7v1.4l1.8 1.7-2 3.4-2.4-.7-1.2.7L14 19.4h-4L9.4 17l-1.2-.7-2.4.7-2-3.4 1.8-1.7v-1.4L3.8 8.8l2-3.4 2.4.7 1.2-.7L10 3Z" transform="translate(0 .8)"/><circle cx="12" cy="12" r="3"/></>,
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
  const [threshold, setThreshold] = useState(40);
  const [dismissedAlarm, setDismissedAlarm] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [stationFilter, setStationFilter] = useState('all');
  const dialogRef = useRef(null);
  const panelBody = useRef(null);
  const sessionRevision = useRef(model.sessionRevision);
  sessionRevision.current = model.sessionRevision;
  const [authStorageMode, setAuthStorageMode] = useState('firestore');
  const [authMode, setAuthMode] = useState('login');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [managedUsers, setManagedUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', name: '', password: '', role: 'viewer' });
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [usersBusy, setUsersBusy] = useState(false);
  const [commandLogs, setCommandLogs] = useState([]);
  const [pendingCommand, setPendingCommand] = useState(null);
  const [historyLoadError, setHistoryLoadError] = useState(false);
  const [buzzerMuted, setBuzzerMuted] = useState({});
  const [stationFormOpen, setStationFormOpen] = useState(false);
  const [stationDraft, setStationDraft] = useState(defaultStationDraft);
  const [stationError, setStationError] = useState('');
  const [customLat, setCustomLat] = useState(CENTER[0]);
  const [customLng, setCustomLng] = useState(CENTER[1]);
  const lastSoundRef = useRef(0);

  const { stations, selected, settings, history, dataSource, soundAlert, liveStatus, user, externalWeather } = model;
  const displayStations = dataSource === 'live'
    ? stations.filter((s) => s.registered)
    : stations.filter((s) => !s.custom);

  const selectedIndex = selected === null ? -1 : displayStations.findIndex((s) => s.id === stations[selected]?.id);
  const validSelected = selectedIndex < 0 ? null : selectedIndex;
  const station = validSelected === null ? null : displayStations[validSelected];
  const liveStationIds = displayStations.map((s) => s.id).join(',');
  const canManage = canManageListedStation(user, station);
  const firstManageableIndex = displayStations.findIndex((entry) => canManageListedStation(user, entry));
  const [googleBusy, setGoogleBusy] = useState(false);
  const [registrationInfo, setRegistrationInfo] = useState(null);
  const closeSetup = useCallback(() => setRegistrationInfo(null), []);

  useEffect(() => {
    if (user.role === 'guest') {
      setRegistrationInfo(null);
      setStationFormOpen(false);
      setStationFilter('all');
    }
    if (user.role !== 'admin') setManagedUsers([]);
  }, [user.role]);
  const [stationBusy, setStationBusy] = useState(false);
  const [warningThreshold, setWarningThreshold] = useState(5);
  const [directionOffset, setDirectionOffset] = useState(0);

  const [deletingStation, setDeletingStation] = useState(false);

  async function refreshRegistry() {
    const response = await fetch('/api/stations', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Daftar stasiun belum tersedia.');
    dispatch({ type: 'registry', stations: data.stations });
  }

  useEffect(() => {
    let active = true;
    fetch('/api/stations', { cache: 'no-store' }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Daftar stasiun belum tersedia.');
      if (active) dispatch({ type: 'registry', stations: data.stations });
    }).catch((error) => { if (active) setToast(error.message); });
    return () => { active = false; };
  }, [user.username, user.role]);

  useEffect(() => {
    const config = station?.settings;
    if (!config) return;
    setThreshold(config.dangerKmh);
    setWarningThreshold(config.warningKmh);
    setDirectionOffset(config.directionOffsetDeg);
  }, [station?.id, station?.settings]);


  useEffect(() => {
    let saved = DEFAULT_SETTINGS;
    let savedSource = 'live';
    let savedSound = true;
    let savedUser = { username: 'guest', role: 'guest', name: 'Tamu Publik' };
    let savedCoords = null;
    let savedStations = [];

    try {
      const val = JSON.parse(localStorage.getItem('bayu-settings') || 'null');
      if (val && Number.isFinite(val.threshold) && val.threshold >= 1 && val.threshold <= 120) saved = val;
      localStorage.removeItem('bayu-datasource');
      const snd = JSON.parse(localStorage.getItem('bayu-sound') || 'true');
      savedSound = Boolean(snd);
      localStorage.removeItem('bayu-sharekey');
      localStorage.removeItem('bayu-user');
      localStorage.removeItem('bayu-stored-users');
      localStorage.removeItem('bayu-telegram');
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
      user: savedUser,
    });
    let active = true;
    async function syncSession() {
      const revision = sessionRevision.current;
      try {
        const res = await fetch('/api/auth', { cache: 'no-store' });
        if (!res.ok || !active) return;
        const data = await res.json();
        if (!active) return;
        if (data.mode) setAuthStorageMode(data.mode);
        dispatch({ type: 'refresh_session', ...data, revision });
      } catch {}
    }
    syncSession();
    const sessionTimer = setInterval(syncSession, 60000);
    if (savedCoords) {
      setCustomLat(savedCoords.lat);
      setCustomLng(savedCoords.lng);
    }
    setThreshold(saved.threshold);
    setClock(Date.now());

    // Fetch external weather once on load
    fetch('/api/weather')
      .then((res) => res.json())
      .then((data) => { if (data && !data.error) dispatch({ type: 'set_weather', weather: data }); })
      .catch(() => {});

    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { active = false; clearInterval(timer); clearInterval(sessionTimer); };
  }, []);

  useEffect(() => {
    if (dataSource !== 'live') return;
    if (!liveStationIds) { dispatch({ type: 'set_live_status', status: 'empty' }); return; }
    let active = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const statuses = await Promise.all(liveStationIds.split(',').map(async (id) => {
          try {
            const res = await fetch(`/api/check-data?stationId=${encodeURIComponent(id.toLowerCase())}`, { signal: AbortSignal.timeout(8000) });
            const data = await res.json();
            if (!res.ok || !data || data.error || data.stationId?.toLowerCase() !== id.toLowerCase()) throw new Error('Data unavailable');
            if (active) dispatch(data.status === 'waiting' ? { type: 'station_unavailable', id } : { type: 'live_tick', telemetry: data });
            return data.status;
          } catch {
            if (active) dispatch({ type: 'station_unavailable', id });
            return 'error';
          }
        }));
        if (active) dispatch({ type: 'set_live_status', status: statuses.includes('recent') ? 'recent' : statuses.includes('stale') ? 'stale' : statuses.includes('waiting') ? 'waiting' : 'error' });
      } finally {
        polling = false;
      }
    };
    poll();
    const interval = setInterval(poll, user.role === 'guest' ? 12000 : 3500);
    return () => { active = false; clearInterval(interval); };
  }, [dataSource, liveStationIds, user.username, user.role]);

  useEffect(() => {
    if (!authOpen || user.role !== 'admin') return;
    fetch('/api/users', { cache: 'no-store' }).then((res) => res.json())
      .then((data) => { if (Array.isArray(data.users)) setManagedUsers(data.users); })
      .catch(() => {});
  }, [authOpen, user.role]);

  useEffect(() => {
    if (dataSource !== 'live' || !liveStationIds) return;
    let active = true;
    setHistoryLoadError(false);
    Promise.allSettled(liveStationIds.split(',').map(async (id) => {
      const res = await fetch(`/api/history?stationId=${encodeURIComponent(id.toLowerCase())}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Riwayat tidak tersedia');
      return (await res.json()).rows || [];
    })).then((groups) => {
      if (!active) return;
      dispatch({ type: 'load_history', rows: groups.flatMap((result) => result.status === 'fulfilled' ? result.value : []) });
      setHistoryLoadError(groups.some((result) => result.status === 'rejected'));
    });
    return () => { active = false; };
  }, [dataSource, liveStationIds, user.username, user.role]);

  useEffect(() => {
    if (!soundAlert) return;
    const isAlarm = displayStations.some((s) => s.online && s.speed >= (s.settings?.dangerKmh ?? settings.threshold));
    if (isAlarm && Date.now() - lastSoundRef.current > 12000) {
      lastSoundRef.current = Date.now();
      playWarningBeep();
    }
  }, [displayStations, settings.threshold, soundAlert]);


  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2600); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    function escape(event) {
      if (event.key !== 'Escape') return;
      if (registrationInfo) return; // Setup handles its own Escape and focus.
      if (authOpen) setAuthOpen(false);
      else if (stationFormOpen) setStationFormOpen(false);
      else if (listOpen) { setListOpen(false); setSearch(''); }
      else dispatch({ type: 'select', index: null });
    }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [registrationInfo, authOpen, stationFormOpen, listOpen]);

  const modalOpen = authOpen || stationFormOpen;
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    (dialog?.querySelector('input') || dialog?.querySelector('button'))?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [modalOpen, authMode]);

  useEffect(() => {
    if (panelBody.current) panelBody.current.scrollTop = 0;
  }, [tab, station?.id, listOpen]);

  const filtered = displayStations.map((s, index) => ({ ...s, index })).filter((s) => (user.role === 'guest' || stationFilter === 'all' || s.ownerId === user.username) &&
    `${s.name} ${s.id}`.toLowerCase().includes(search.trim().toLowerCase()));
  function select(index, nextTab = 'summary') {
    const target = displayStations[index];
    if (!target) return;
    dispatch({ type: 'select', index: stations.findIndex((entry) => entry.id === target.id) });
    setListOpen(false);
    setSearch('');
    setTab(nextTab);
  }
  function close() { dispatch({ type: 'select', index: null }); setListOpen(false); }

  function openStationForm() {
    if (user.role === 'guest') {
      setAuthOpen(true);
      setToast('Masuk untuk mendaftarkan stasiun.');
      return;
    }
    setStationDraft(defaultStationDraft());
    setStationError('');
    setStationFormOpen(true);
  }

  async function addStation(event) {
    event.preventDefault();
    if (user.role === 'guest' || stationBusy) return;
    setStationBusy(true);
    try {
      const response = await fetch('/api/stations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stationDraft) });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error || 'Pendaftaran gagal.');
      setRegistrationInfo({ ...data.station, topics: data.topics });
      dispatch({ type: 'toggle_source', source: 'live' });
      setStationFormOpen(false);
      setToast('Stasiun tersimpan. Siapkan koneksi MQTT alat.');
      refreshRegistry().catch(() => setToast('Stasiun tersimpan. Muat ulang peta untuk melihatnya.'));
    } catch (error) { setStationError(error.message); }
    finally { setStationBusy(false); }
  }

  async function deleteStation() {
    if (!canManage || !station || pendingCommand || deletingStation) return;
    const { id, name } = station;
    if (!window.confirm(`Hapus "${name}" dari peta BAYU? Riwayat disimpan sebagai arsip. Pengelola perlu menonaktifkan akun MQTT perangkat secara terpisah di EMQX.`)) return;
    setDeletingStation(true);
    try {
      const response = await fetch(`/api/stations/${encodeURIComponent(id.toLowerCase())}`, { method: 'DELETE' });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error || 'Stasiun belum terhapus.');
      dispatch({ type: 'remove_station', id });
      setCommandLogs((logs) => logs.filter((entry) => entry.stationId !== id));
      setBuzzerMuted((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      setTab('summary');
      setToast(`${name} dihapus dari peta.`);
    } catch (error) {
      setToast(error.message);
    } finally {
      setDeletingStation(false);
    }
  }

  async function handleGoogleLogin() {
    setGoogleBusy(true);
    try {
      const idToken = await googleIdToken();
      const response = await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error || 'Login Google gagal.');
      dispatch({ type: 'set_user', user: data.user });
      setAuthOpen(false);
      setToast('Berhasil masuk. Akun dan stasiun tersimpan di server.');
    } catch (error) {
      const message = error.code === 'auth/unauthorized-domain' ? `Tambahkan ${window.location.hostname} di Firebase Authentication → Authorized domains.`
        : error.code === 'auth/operation-not-allowed' ? 'Aktifkan provider Google di Firebase Authentication.'
        : error.code === 'auth/popup-closed-by-user' ? 'Login Google dibatalkan.' : error.message;
      setToast(message);
    } finally { setGoogleBusy(false); }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError('');
    try {
      const url = authMode === 'register' ? '/api/auth/register' : '/api/auth';
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: authName, username: authUsername, password: authPassword }) });
      const data = await readApiResponse(res);
      if (!res.ok) throw new Error(data.error || 'Login gagal.');
      dispatch({ type: 'set_user', user: data.user });
      setAuthOpen(false);
      setAuthPassword('');
      setAuthMode('login');
      setToast(`Berhasil masuk sebagai ${data.user.name}.`);
    } catch (error) { setAuthError(error.message); }
    finally { setAuthBusy(false); }
  }

  async function handleLogout() {
    try {
      const response = await fetch('/api/auth', { method: 'DELETE' });
      if (!response.ok) throw new Error();
    } catch { setToast('Belum bisa keluar. Periksa koneksi lalu coba lagi.'); return; }
    const guestUser = { username: 'guest', role: 'guest', name: 'Tamu Publik' };
    dispatch({ type: 'set_user', user: guestUser });
    setToast('Keluar akun. Sekarang dalam mode Tamu.');
    setAuthOpen(false);
  }

  async function createManagedUser(event) {
    event.preventDefault();
    if (usersBusy) return;
    setUsersBusy(true);
    try {
      const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newUser) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuat akun.');
      setManagedUsers((current) => [...current, data.user].sort((a, b) => a.username.localeCompare(b.username)));
      setNewUser({ username: '', name: '', password: '', role: 'viewer' });
      setToast(`Akun ${data.user.username} dibuat.`);
    } catch (error) { setToast(error.message); }
    finally { setUsersBusy(false); }
  }

  async function toggleManagedUser(account) {
    if (usersBusy) return;
    setUsersBusy(true);
    try {
      const res = await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: account.username, enabled: !account.enabled }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengubah akun.');
      setManagedUsers((current) => current.map((item) => item.username === account.username ? data.user : item));
      setToast(`${account.username} ${data.user.enabled ? 'diaktifkan' : 'dinonaktifkan'}.`);
    } catch (error) { setToast(error.message); }
    finally { setUsersBusy(false); }
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (settingsBusy) return;
    if (!canManage || !station?.registered) {
      setToast('Daftarkan stasiun dan masuk sebagai pemilik untuk menyimpan konfigurasi.');
      return;
    }
    setSettingsBusy(true);
    try {
      const config = { warningKmh: Number(warningThreshold), dangerKmh: Number(threshold),
        directionOffsetDeg: Number(directionOffset) };
      const response = await fetch('/api/stations/' + station.id.toLowerCase(), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      dispatch({ type: 'station_settings', id: station.id, settings: data.settings });
      dispatch({ type: 'settings', settings: { threshold: config.dangerKmh } });
      setToast('Pengaturan web tersimpan. Terapkan batas angin ke ESP untuk menyamakan alarm alat.');
    } catch (error) { setToast(error.message || 'Konfigurasi belum tersimpan.'); }
    finally { setSettingsBusy(false); }
  }

  async function sendDownlink(action) {
    if (pendingCommand || dataSource !== 'live') return;
    if (!canManage) {
      setToast('Masuk sebagai pemilik stasiun untuk mengirim perintah.');
      setAuthOpen(true);
      return;
    }
    const targetId = station?.id || 'angin-01';
    setPendingCommand(action);
    const label = { calibrate_zero: 'Kalibrasi arah utara', buzzer_mute: 'Senyapkan buzzer', buzzer_unmute: 'Aktifkan buzzer', request_telemetry: 'Perbarui pembacaan', apply_settings: 'Terapkan ambang alarm' }[action] || action;
    const log = (success, message) => setCommandLogs((prev) => [{ stationId: targetId, label, success, message, time: Date.now() }, ...prev].slice(0, 40));
    setToast(`Mengirim perintah [${action}] ke ${targetId}…`);
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, stationId: targetId }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await readApiResponse(res);
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

  const alarmStation = displayStations.find((s) => s.online && s.speed >= (s.settings?.dangerKmh ?? settings.threshold));
  const stationHistory = station ? history.filter((r) => r.id === station.id) : history;
  const stationStats = calculateStats(stationHistory);
  const stationWindRose = calculateWindRose(stationHistory);
  const deviceHealth = getDeviceHealth(station);

  return (
    <main className={`map-app ${station && !listOpen ? 'panel-open' : ''} `}>
      <WindMap stations={displayStations} selected={validSelected} settings={settings} onSelect={select} onClear={close} focusRequest={focusRequest} fitRequest={fitRequest} />

      {/* User Auth Pill Button */}
      <button className="user-pill" onClick={() => setAuthOpen(true)} title="Kelola Akun & Akses" aria-label={user.role === 'guest' ? 'Masuk atau daftar akun' : 'Kelola akun'}>
        <Icon name="user" size={14} />
        <span>{user.role === 'guest' ? 'Masuk Akun' : user.name.split(' ')[0]}</span>
        <span className={`role-badge ${user.role}`}>{user.role === 'admin' ? 'Admin' : user.role === 'guest' ? 'Tamu' : 'Akun'}</span>
      </button>

      <div className="map-navigation" aria-label="Navigasi peta">
        <div className="map-north" role="img" aria-label="Orientasi peta, utara di atas" title="Utara selalu di atas">
          <span className="north-label">U</span><span className="west-label">B</span><span className="east-label">T</span><span className="south-label">S</span>
          <svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 5 29 30 20 25Z" fill="#db5358"/><path d="M20 5 11 30 20 25Z" fill="#aabac2"/></svg>
        </div>
        <button className="map-settings-button" aria-label="Buka pengaturan stasiun" title="Pengaturan stasiun" onClick={() => {
          if (user.role === 'guest') { setAuthOpen(true); return; }
          if (firstManageableIndex < 0) { openStationForm(); return; }
          select(canManage ? validSelected : firstManageableIndex, 'settings');
        }}><Icon name="settings" size={23} /></button>
      </div>

      {/* Auth Modal */}
      {stationFormOpen && user.role !== 'guest' && (
        <div className="auth-overlay" onClick={() => setStationFormOpen(false)}>
          <section ref={dialogRef} className="station-dialog" role="dialog" aria-modal="true" aria-labelledby="new-station-title"
            onClick={(e) => e.stopPropagation()} onKeyDown={trapDialogFocus}>
            <div className="station-dialog-heading">
              <div><h2 id="new-station-title">Tambah stasiun</h2></div>
              <button type="button" className="plain-icon" aria-label="Tutup tambah stasiun" onClick={() => setStationFormOpen(false)}><Icon name="close" size={18} /></button>
            </div>
            <p>Daftarkan alat dan tentukan lokasinya di peta.</p>
            <form onSubmit={addStation} className="station-form">
              <label>Nama stasiun<input autoFocus required maxLength={80} placeholder="Mis. Stasiun Lapangan Timur" value={stationDraft.name} onChange={(e) => setStationDraft({ ...stationDraft, name: e.target.value })} /></label>
              {user.role === 'admin' ? <label>ID alat yang sudah ada (opsional)<input maxLength={64} pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" placeholder="Kosongkan untuk ID otomatis" value={stationDraft.id} onChange={(e) => setStationDraft({ ...stationDraft, id: e.target.value })} /></label> : <p>ID alat akan dibuat otomatis dan dihubungkan ke akun Anda.</p>}
              <fieldset><legend>Koordinat cadangan</legend><div className="coordinate-fields">
                <label>Latitude<input required type="number" step="any" min="-90" max="90" value={stationDraft.lat} onChange={(e) => setStationDraft({ ...stationDraft, lat: e.target.value })} /></label>
                <label>Longitude<input required type="number" step="any" min="-180" max="180" value={stationDraft.lng} onChange={(e) => setStationDraft({ ...stationDraft, lng: e.target.value })} /></label>
              </div><small>Dipakai saat GPS alat belum mendapat lokasi.</small></fieldset>
              <p className="station-storage-note">Stasiun tersimpan di akun Anda. Pembacaan muncul setelah alat terhubung dan mengirim data.</p>
              {stationError && <p className="station-form-error" role="alert">{stationError}</p>}
              <div className="station-form-actions"><button type="button" onClick={() => setStationFormOpen(false)}>Batal</button><button type="submit" className="primary-button" disabled={stationBusy}><Icon name="plus" size={16} />{stationBusy ? 'Mendaftarkan…' : 'Daftarkan stasiun'}</button></div>
            </form>
          </section>
        </div>
      )}
      {authOpen && (
        <div className="auth-overlay" onClick={() => setAuthOpen(false)}>
          <div ref={dialogRef} className="auth-card" role="dialog" aria-modal="true" aria-labelledby="account-title"
            onClick={(e) => e.stopPropagation()} onKeyDown={trapDialogFocus}>
            <div className="auth-header">
              <h2 id="account-title">{user.role === 'admin' ? 'Kelola Akun' : user.role === 'guest' ? (authMode === 'register' ? 'Daftar akun' : 'Masuk akun') : 'Akun Saya'}</h2>
              <button className="auth-close" aria-label="Tutup akun" onClick={() => setAuthOpen(false)}>✕</button>
            </div>

            {user.role !== 'guest' ? (
              <div>
                <p style={{ fontSize: '13px', color: '#475569', marginBottom: '14px' }}>
                  Masuk sebagai <b>{user.name}</b> ({user.role === 'admin' ? 'Administrator' : 'Akun BAYU'}).
                </p>
                {user.role === 'admin' && <div className="user-management">
                  <h3>Akun {authStorageMode === 'local-demo' ? 'demo lokal' : 'tersimpan di Firestore'}</h3>
                  <div className="managed-user-list">
                    {managedUsers.map((account) => <div className="managed-user" key={account.username}>
                      <span><b>{account.name}</b><small>{account.username} · {account.role === 'admin' ? 'Admin' : 'Pembaca'}</small></span>
                      <button type="button" disabled={usersBusy || account.username === user.username} onClick={() => toggleManagedUser(account)}>
                        {account.enabled ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </div>)}
                  </div>
                  <form className="auth-form" onSubmit={createManagedUser}>
                    <h3>Tambah akun</h3>
                    <label>Username<input required minLength={3} maxLength={32} value={newUser.username} onChange={(e) => setNewUser((value) => ({ ...value, username: e.target.value }))} /></label>
                    <label>Nama<input required maxLength={80} value={newUser.name} onChange={(e) => setNewUser((value) => ({ ...value, name: e.target.value }))} /></label>
                    <label>Password<input type="password" required minLength={12} autoComplete="new-password" value={newUser.password} onChange={(e) => setNewUser((value) => ({ ...value, password: e.target.value }))} /></label>
                    <label>Role<select value={newUser.role} onChange={(e) => setNewUser((value) => ({ ...value, role: e.target.value }))}><option value="viewer">Pembaca</option><option value="admin">Administrator</option></select></label>
                    <button type="submit" className="auth-btn" disabled={usersBusy}>Buat akun</button>
                  </form>
                </div>}
                <button type="button" className="auth-btn" style={{ background: '#e2e8f0', color: '#334155' }} onClick={handleLogout}>
                  Keluar Akun (Ke Mode Tamu)
                </button>
              </div>
            ) : (
              <>
                <form className="auth-form" onSubmit={handleAuthSubmit}>
                  {authMode === 'register' && <label>Nama<input required maxLength={80} autoComplete="name" value={authName} onChange={(e) => setAuthName(e.target.value)} /></label>}
                  <label>Username<input required minLength={3} maxLength={32} autoComplete="username" value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} /></label>
                  <label>Password<input type="password" required maxLength={128} minLength={authMode === 'register' ? 12 : undefined}
                    autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} /></label>
                  {authMode === 'register' && <p className="auth-hint">Gunakan minimal 12 karakter untuk password.</p>}
                  {authError && <p className="setup-error" role="alert">{authError}</p>}
                  <button type="submit" className="auth-btn" disabled={authBusy || googleBusy}>{authBusy ? 'Memproses…' : authMode === 'register' ? 'Buat akun' : 'Masuk'}</button>
                </form>
                <div className="login-divider"><span>atau</span></div>
                <button type="button" className="auth-btn google-login" disabled={googleBusy || authBusy} onClick={handleGoogleLogin}>{googleBusy ? 'Menghubungkan Google…' : 'Lanjut dengan Google'}</button>
                <p className="auth-mode-switch">{authMode === 'register' ? 'Sudah punya akun?' : 'Belum punya akun?'} <button type="button" disabled={authBusy || googleBusy}
                  onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setAuthError(''); setAuthPassword(''); }}>{authMode === 'register' ? 'Masuk' : 'Daftar'}</button></p>
              </>
            )}
          </div>
        </div>
      )}

      {registrationInfo && user.role !== 'guest' && <StationSetupDialog station={registrationInfo}
        online={Boolean(stations.find((entry) => entry.id.toLowerCase() === registrationInfo.id.toLowerCase())?.online)}
        onClose={closeSetup} />}

      {dataSource === 'live' && displayStations.length === 0 && !stationFormOpen && (
        <section className="map-welcome" aria-labelledby="welcome-title">
          <div className="welcome-wind"><Icon name="wind" size={28} /></div>
          <h1 id="welcome-title">{user.role === 'guest' ? 'Pantau angin dari stasiunmu' : 'Stasiun pertamamu dimulai di sini'}</h1>
          <p>{user.role === 'guest' ? 'Stasiun publik akan tampil di peta saat tersedia. Masuk untuk mendaftarkan dan mengatur alat.' : 'Beri nama stasiun, tentukan lokasi, lalu siapkan koneksi dan format kirim data alat.'}</p>
          <button className="primary-button" onClick={() => user.role === 'guest' ? setAuthOpen(true) : openStationForm()}>{user.role === 'guest' ? 'Masuk akun' : 'Daftarkan stasiun'}</button>
        </section>
      )}

      {alarmStation && !dismissedAlarm && (
        <div className="alert-banner" role="alert">
          <span>Peringatan angin: {alarmStation.name} ({alarmStation.id}) {format(alarmStation.speed)} km/jam melewati batas aman!</span>
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
        <button className="plain-icon" aria-label={listOpen ? 'Sembunyikan hasil pencarian' : 'Lihat hasil pencarian'} aria-expanded={listOpen} onClick={() => { setListOpen(!listOpen); if (listOpen) setSearch(''); }}>
          <Icon name={listOpen ? 'close' : 'search'} />
        </button>
        <button className="plain-icon add-station-shortcut" aria-label="Tambah stasiun" title="Tambah stasiun" onClick={openStationForm}><Icon name="plus" size={19} /></button>
      </div>

      {!listOpen && (
        <div className="location-chip">
          <button className="station-switcher" aria-expanded={listOpen} aria-label="Buka daftar stasiun" onClick={() => { setStationFilter('all'); setListOpen(true); }}>
            <Icon name="radio" size={17} /><span className="station-switcher-label">Stasiun</span><span className="station-count">{displayStations.length}</span><Icon name="chevron" size={16} />
          </button>
        </div>
      )}

      <div className="simulation-control">
          <div className={`live-badge ${liveStatus}`}>
            <i />
            {({ recent: 'Alat terhubung', stale: 'Data terakhir', error: 'Data belum tersedia', waiting: 'Menunggu alat', 'signed-out': 'Masuk untuk memantau', empty: 'Belum ada stasiun', polling: 'Memuat data…' })[liveStatus] || 'Memuat data…'}
          </div>
      </div>

      {listOpen && (
        <aside className="station-list" aria-label="Daftar stasiun">
          <div className="list-heading">
            <span>Daftar stasiun</span>
            <button type="button" className="plain-icon" aria-label="Tutup daftar stasiun"
              onClick={() => { setListOpen(false); setSearch(''); }}><Icon name="close" size={16} /></button>
          </div>
          {user.role !== 'guest' && <div className="station-directory-filter" aria-label="Filter stasiun">
            <button aria-pressed={stationFilter === 'all'} onClick={() => setStationFilter('all')}>Semua</button>
            <button aria-pressed={stationFilter === 'owned'} onClick={() => setStationFilter('owned')}>Milik saya</button>
          </div>}
          {filtered.map((s) => (
            <button className="station-result" key={s.id} onClick={() => select(s.index)}>
              <span className={`station-dot ${state(s, settings)}`}>↑</span>
              <span className="result-text">
                <b>{s.name}</b>
                <small>{s.ownerId === user.username ? 'Milik saya' : !s.ownerId ? 'Publik' : s.id} · {stateLabel(s, settings)}</small>
              </span>
              <span className="result-speed">{s.online ? format(s.speed) : '—'}<small>km/jam</small></span>
            </button>
          ))}
          {!filtered.length && <p className="no-results">{!search && stationFilter === 'owned' && user.role !== 'guest' ? 'Belum ada stasiun di akun ini.' : 'Stasiun tidak ditemukan.'}</p>}
          <button className="add-station-row" onClick={openStationForm}><Icon name="plus" size={17} /><span>Tambah stasiun</span><Icon name="chevron" size={14} /></button>
          <div className="list-footnote">{filtered.length} stasiun</div>
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
                ? 'Diperbarui ' + (clock ? timeLabel(station.updated) : '—')
                : !station.updated ? 'Menunggu data alat' : 'Data terakhir · ' + (clock ? Math.max(1, Math.floor((clock - station.updated) / 60000)) : 3) + ' menit lalu'}
            </span>
          </div>

          <div className="panel-actions">
            <button onClick={() => setFocusRequest((v) => v + 1)}><Icon name="locate" size={17} />Fokus lokasi</button>
            <button onClick={download}><Icon name="download" size={17} />Unduh CSV</button>
          </div>

          <nav className="detail-tabs" aria-label="Detail stasiun">
            {[
              ['summary', 'Ringkasan'],
              ['history', 'Riwayat'],
              ['control', 'Kontrol Alat'],
              ['settings', 'Pengaturan'],
            ].filter(([id]) => canManage || id === 'summary' || id === 'history').map(([id, title]) => (
              <button className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} key={id} onClick={() => setTab(id)}>
                {title}
              </button>
            ))}
          </nav>

          <div className="panel-body" ref={panelBody}>
            {tab === 'summary' && (
              <>
                <section className="wind-stat">
                  <div className="stat-label">Kecepatan angin{!station.online && <span>{station.updated ? 'Data terakhir' : 'Belum ada pembacaan'}</span>}</div>
                  <div className="speed-number">{station.updated ? format(station.speed) : '—'}<span>km/jam</span></div>
                  {station.updated > 0 && <div className="speed-secondary">{format(station.speed / 3.6)} m/s <span>·</span> {station.speed >= (station.settings?.dangerKmh ?? settings.threshold) ? 'Melewati ambang alarm' : 'Di bawah ambang alarm'}</div>}
                </section>

                {station.updated > 0 && <section className="direction-stat">
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
                </section>}

                {/* Weather Comparison Widget */}
                {externalWeather && station.online && station.updated > 0 && (
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
                {canManage && <div className="health-box">
                  <div className="health-title">
                    <span>Diagnostik Kesehatan Alat</span>
                      <small>{station.source === 'mqtt' ? 'Nilai dari telemetri alat' : 'Belum ada telemetri alat'}</small>
                  </div>
                  <div className="health-grid">
                    <div className="health-item">
                      <small>Wi-Fi RSSI</small>
                      <b>{deviceHealth.wifiRssi === null ? deviceHealth.wifiStatus : `${deviceHealth.wifiRssi} dBm (${deviceHealth.wifiStatus})`}</b>
                    </div>
                    <div className="health-item">
                      <small>Sensor AS5600</small>
                      <b>{deviceHealth.as5600Status}</b>
                    </div>
                    <div className="health-item">
                      <small>Kehilangan paket</small>
                      <b>{deviceHealth.espNowLoss}</b>
                    </div>
                    <div className="health-item">
                      <small>Heap ESP32</small>
                      <b>{deviceHealth.heapKb === null ? 'Belum tersedia' : `${deviceHealth.heapKb} KB bebas`}</b>
                    </div>
                    <div className="health-item">
                      <small>Uptime ESP32</small>
                      <b>{deviceHealth.uptime}</b>
                    </div>
                    <div className="health-item">
                      <small>Status GPS</small>
                      <b>{deviceHealth.gpsStatus}</b>
                    </div>
                  </div>
                </div>}

                <dl className="device-details">
                  <div><dt>Hubungan jaringan</dt><dd>{station.online ? 'Terhubung' : 'Terputus'}</dd></div>
                  <div><dt>Ambang alarm</dt><dd>{station.settings?.dangerKmh ?? settings.threshold} km/jam</dd></div>
                  {station.directionBackendFresh === false && <div><dt>Koreksi ke LCD</dt><dd>Menunggu balasan backend; LCD memakai arah terakhir.</dd></div>}
                  <div><dt>Sumber telemetri</dt><dd>{station.source === 'mqtt' ? 'MQTT TLS' : 'Menunggu alat'}</dd></div>
                  {station.ageSeconds !== undefined && (
                    <div><dt>Usia paket data</dt><dd>{station.ageSeconds} dtk lalu</dd></div>
                  )}
                </dl>

                <section className="history-preview">
                  <div className="chart-heading">
                    <h2>Kecepatan terakhir</h2>
                    <span>km/jam</span>
                  </div>
                  <div className="chart" role="img" aria-label={`${station.samples.length} sampel kecepatan ${station.id}`}>
                    {station.samples.map((v, index) => (
                      <span title={`${format(v)} km/jam`} key={index} style={{ height: `${Math.max(3, Math.min(100, (v / 60) * 100))}%` }} />
                    ))}
                  </div>
                  <div className="chart-labels">
                    <span>{station.samples.length} sampel alat</span>
                    <span>Terbaru</span>
                  </div>
                </section>

                <section className="coordinates">
                  <span>{canManage ? "Koordinat stasiun" : "Perkiraan lokasi"}</span>
                  <p>{station.lat.toFixed(canManage ? 6 : 3)}, {station.lng.toFixed(canManage ? 6 : 3)}</p>
                </section>
              </>
            )}

            {tab === 'history' && (
              <section className="history-section">
                <h2>Riwayat & Analitik</h2>
                <p>{dataSource === 'live' ? 'Riwayat tersimpan di Firestore dan pembacaan terbaru dari alat.' : 'Selama sesi halaman ini dibuka.'}</p>
                {dataSource === 'live' && historyLoadError && <p role="status">Riwayat tersimpan belum bisa dimuat. Data yang tersedia berasal dari sesi ini.</p>}

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
                        <td>{'IoT Real'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!stationHistory.length && <p>Belum ada pembacaan baru dari stasiun ini.</p>}
              </section>
            )}

            {tab === 'control' && canManage && (
              <section className="control-box">
                <div className="control-heading"><div><span className="section-eyebrow">AKSES PERANGKAT</span><h2>Kontrol stasiun</h2></div><span className={`connection-pill ${dataSource === 'live' && station.online ? 'connected' : ''}`}><i />{station.online ? 'Terhubung' : 'Offline'}</span></div>
                <p className="control-intro">Kelola sensor dan alarm pada {station.id}.</p>
                {!canManage ? <div className="control-notice"><span>Kontrol alat memerlukan akun pemilik stasiun.</span><button onClick={() => setAuthOpen(true)}>Masuk<Icon name="chevron" size={13} /></button></div> : <p className="control-notice">Perintah dikirim melalui koneksi aman dan menunggu konfirmasi alat.</p>}
                <div className="command-actions" aria-busy={Boolean(pendingCommand)}>
                  {[
                    { action: (station.muted ?? buzzerMuted[station.id]) ? 'buzzer_unmute' : 'buzzer_mute', icon: 'mute', label: (station.muted ?? buzzerMuted[station.id]) ? 'Aktifkan buzzer' : 'Senyapkan buzzer', description: (station.muted ?? buzzerMuted[station.id]) ? 'Kirim permintaan untuk menyalakan alarm.' : 'Kirim permintaan untuk mematikan suara alarm.' },
                    { action: 'request_telemetry', icon: 'refresh', label: 'Perbarui pembacaan', description: 'Minta data terbaru dari stasiun.' },
                  ].map((item) => <button key={item.action} type="button" className="command-btn" disabled={!canManage || dataSource !== 'live' || Boolean(pendingCommand)} onClick={() => sendDownlink(item.action)}><span className="command-icon"><Icon name={item.icon} size={19} /></span><span className="command-copy"><b>{item.label}</b><small>{pendingCommand === item.action ? 'Mengirim perintah…' : item.description}</small></span>{pendingCommand === item.action ? <span className="command-spinner" /> : <Icon name="chevron" size={15} />}</button>)}
                </div>
                <DirectionCalibration key={station.id} stationId={station.id} enabled={canManage} blocked={Boolean(pendingCommand)} />
                <div className="command-history-heading"><h3>Aktivitas perintah</h3><span>Sesi ini</span></div>
                <div className="command-log" role="log" aria-label="Aktivitas perintah stasiun" aria-live="polite">
                  {commandLogs.some((entry) => entry.stationId === station.id) ? commandLogs.filter((entry) => entry.stationId === station.id).slice(0, 10).map((entry, i) => <div className="command-entry" key={`${entry.time}-${i}`}><i className={entry.success ? 'queued' : 'failed'} /><div><b>{entry.label}</b><small>{entry.success ? 'Dikonfirmasi ESP' : entry.message || 'Gagal dikirim'}</small></div><time>{timeLabel(entry.time)}</time></div>) : <div className="command-empty"><Icon name="radio" size={22} /><span>Belum ada aktivitas<small>Perintah yang dikirim akan muncul di sini.</small></span></div>}
                </div>
              </section>
            )}

            {tab === 'settings' && canManage && <StationSettings key={station.id} station={station} canManage={canManage}
              warningThreshold={warningThreshold} setWarningThreshold={setWarningThreshold} threshold={threshold} setThreshold={setThreshold}
              directionOffset={directionOffset} setDirectionOffset={setDirectionOffset}
              soundAlert={soundAlert} onSound={() => dispatch({type:'toggle_sound'})} onSave={saveSettings} saving={settingsBusy}
              pendingCommand={pendingCommand} onApply={() => sendDownlink('apply_settings')}
              onLocationSaved={(location) => dispatch({type:'station_location',id:station.id,location})}
              onSetup={() => setRegistrationInfo({...station,id:station.id.toLowerCase()})}
              onDelete={deleteStation} deleting={deletingStation} />}


            <p className="panel-disclosure">
              {dataSource === 'live' ? station.source === 'mqtt' ? (canManage ? 'Lokasi mengikuti GPS alat atau koordinat cadangan.' : 'Peta publik menampilkan perkiraan lokasi stasiun.') : 'Menunggu pembacaan pertama dari alat. Peta menampilkan koordinat cadangan.' : 'Menunggu data alat.'}
            </p>
          </div>
        </aside>
      )}

      <div className="map-key">
        <span><i className="key-normal" />Normal</span>
        <span><i className="key-warning" />Angin sedang</span>
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
