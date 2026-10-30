import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { pomodoroApi, sessionsApi, DEFAULT_POMODORO, errorMessage } from '../lib/api.js';
import { fmtClock } from '../lib/dates.js';
import { useToast } from './toast.jsx';
import { prefsApi } from '../lib/api.js';
import { getCtx, unlockAudio, playAlarm, scheduleAlarm, scheduledAlarm, stopAlarm, setAmbient, audioRunning } from '../lib/audio.js';

const TimerCtx = createContext(null);
export const useTimer = () => useContext(TimerCtx);
export const PHASE_LABEL = { focus: 'Focus', short_break: 'Short break', long_break: 'Long break' };

export { unlockAudio };
// kept for older imports: the short preview of the end-of-session alarm
export function playChime() { playAlarm({ short: true }); }

const MUSIC_KEY = 'resumed.music.v1';
// choices saved by the short-lived YouTube version map back to the built-in sounds
const musicKind = (k) => ({ piano1: 'piano', piano2: 'piano', flute: 'violin' }[k] || (['none', 'piano', 'violin', 'guitar', 'rain'].includes(k) ? k : 'none'));
function readMusicPref() {
  try { const v = JSON.parse(window.localStorage.getItem(MUSIC_KEY) || 'null'); if (v && typeof v === 'object') return { volume: 0.6, ...v, kind: musicKind(v.kind) }; } catch { /* ignore */ }
  return { kind: 'none', volume: 0.6 };
}

// The timer lives on the server (timestamps). The browser only displays it, using a clock offset
// measured against the database clock, so refreshing / closing the tab / switching device is safe.
export function TimerProvider({ children }) {
  const toast = useToast();
  const [data, setData] = useState(null);         // last server payload
  const [offset, setOffset] = useState(0);        // serverClock - localClock (ms)
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(null);
  const [settingsSaved, setSettingsSaved] = useState(false);   // false => defaults are displayed, nothing stored yet
  const [completedToday, setCompletedToday] = useState(null);
  const completing = useRef(false);
  const settingsRef = useRef(settings); settingsRef.current = settings;

  const refreshToday = useCallback(async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    try {
      const rows = await sessionsApi.since(start.toISOString());
      setCompletedToday(rows.filter((r) => r.status === 'completed').length);
    } catch { /* keep previous value */ }
  }, []);

  const apply = useCallback((payload, t0, t1) => {
    if (!payload || !payload.state) return;
    if (t0 && t1 && payload.server_now) {
      const server = new Date(payload.server_now).getTime();
      setOffset(server - (t0 + t1) / 2);
    }
    setData(payload);
    if (payload.finished_phase) {
      const sound = settingsRef.current && settingsRef.current.sound_enabled;
      if (sound) {
        // the alarm may already be ringing (it is scheduled on the audio clock in advance); otherwise ring now
        const c = getCtx(); const a = scheduledAlarm();
        if (!(a && c && c.currentTime >= a.at - 1 && c.currentTime <= a.end)) playAlarm();
      }
      toast.ok(payload.finished_phase === 'focus' ? 'Focus session complete — well done! Time for a break.' : 'Break over — ready for the next focus session?',
        sound ? { action: 'Stop alarm', onAction: stopAlarm } : undefined);
      refreshToday();
    }
  }, [toast, refreshToday]);

  const call = useCallback(async (fn, { quiet = false } = {}) => {
    const t0 = Date.now();
    try {
      setBusy(true);
      const payload = await fn();
      apply(payload, t0, Date.now());
      setError(null);
      return payload;
    } catch (e) {
      if (!quiet) toast.error(`Timer: ${errorMessage(e)}`);
      setError(e);
      throw e;
    } finally { setBusy(false); }
  }, [apply, toast]);

  const sync = useCallback(() => call(pomodoroApi.sync, { quiet: true }).catch(() => {}), [call]);

  const loadSettings = useCallback(async () => {
    try {
      const s = await pomodoroApi.settings();
      setSettings(s || DEFAULT_POMODORO); setSettingsSaved(!!s);
    } catch { setSettings((x) => x || DEFAULT_POMODORO); }
  }, []);

  useEffect(() => { loadSettings(); sync(); refreshToday(); }, [loadSettings, sync, refreshToday]);
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') { sync(); refreshToday(); } };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [sync, refreshToday]);

  const st = data && data.state;
  const running = st && st.status === 'running';

  // ---- background music (piano, violin, guitar, rain) during focus sessions
  const [music, setMusicState] = useState(readMusicPref);
  const [audioOn, setAudioOn] = useState(audioRunning());
  const [preview, setPreview] = useState(false);
  const previewTimer = useRef(null);
  useEffect(() => {
    prefsApi.get().then((p) => {
      let m = p && p.data && p.data.pomodoro_music;
      if (m && typeof m === 'object' && m.kind) { m = { volume: 0.6, ...m, kind: musicKind(m.kind) }; setMusicState(m); try { window.localStorage.setItem(MUSIC_KEY, JSON.stringify(m)); } catch { /* ignore */ } }
    }).catch(() => {});
    // browsers only allow sound after a user gesture: unlock on the first interaction
    const unlock = () => { const c = unlockAudio(); if (c) c.resume().then(() => setAudioOn(true)).catch(() => {}); };
    window.addEventListener('pointerdown', unlock, true); window.addEventListener('keydown', unlock, true);
    const c = getCtx(); const onState = () => setAudioOn(audioRunning());
    if (c) c.addEventListener('statechange', onState);
    return () => { window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true); if (c) c.removeEventListener('statechange', onState); };
  }, []);
  const focusRunning = !!(running && st.phase === 'focus');
  useEffect(() => {
    if (focusRunning && music.kind !== 'none') setAmbient(music.kind, music.volume);
    else if (!preview) setAmbient('none');
  }, [focusRunning, music, preview, audioOn]);
  useEffect(() => () => setAmbient('none'), []);
  const setMusic = useCallback((patch) => {
    setMusicState((cur) => {
      const next = { ...cur, ...patch };
      try { window.localStorage.setItem(MUSIC_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      prefsApi.merge({ pomodoro_music: next }).catch(() => {});
      return next;
    });
    unlockAudio();
    if (patch.kind && !focusRunning) {           // not in a focus session: let them hear it for a few seconds
      clearTimeout(previewTimer.current);
      if (patch.kind === 'none') { setPreview(false); setAmbient('none'); return; }
      setPreview(true); setAmbient(patch.kind, (patch.volume != null ? patch.volume : music.volume));
      previewTimer.current = setTimeout(() => setPreview(false), 9000);
    }
  }, [focusRunning, music.volume]);

  // ---- the alarm is scheduled on the audio clock ahead of time, so it rings on time even in a background tab
  const soundOn = !!(settings && settings.sound_enabled);
  useEffect(() => {
    if (!running || !soundOn) return undefined;
    const c = getCtx(); if (!c || c.state !== 'running') return undefined;
    let e = st.accumulated_seconds + Math.max(0, (Date.now() + offset - new Date(st.running_since).getTime()) / 1000);
    const left = st.duration_seconds - Math.min(st.duration_seconds, e);
    if (left < 0.3) return undefined;
    const a = scheduleAlarm(c.currentTime + left);
    return () => { if (a && scheduledAlarm() === a && c.currentTime < a.at - 0.05) stopAlarm(); };
  }, [running, soundOn, st && st.running_since, st && st.accumulated_seconds, st && st.duration_seconds, offset, audioOn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  const elapsed = useMemo(() => {
    if (!st) return 0;
    let e = st.accumulated_seconds;
    if (st.status === 'running') e += Math.max(0, (now + offset - new Date(st.running_since).getTime()) / 1000);
    return Math.min(st.duration_seconds, e);
  }, [st, now, offset]);
  const remaining = st ? Math.max(0, st.duration_seconds - elapsed) : 0;

  // reached zero -> ask the server to complete (exactly once; the server de-duplicates anyway)
  useEffect(() => {
    if (!running || remaining > 0 || completing.current) return;
    completing.current = true;
    call(pomodoroApi.complete, { quiet: true })
      .catch(() => new Promise((r) => setTimeout(r, 1500)).then(sync))
      .finally(() => { completing.current = false; });
  }, [running, remaining, call, sync]);

  useEffect(() => {
    const base = 'Resumed Study Tracker';
    document.title = running ? `${fmtClock(remaining)} · ${PHASE_LABEL[st.phase]} — ${base}` : base;
  }, [running, remaining, st]);

  const value = {
    loading: !data && !error, error, data, timer: st, elapsed, remaining, busy,
    settings, settingsSaved, completedToday, music, setMusic, audioOn, preview,
    reloadSettings: loadSettings, refreshToday, sync,
    start: (m, l, tk) => { unlockAudio(); return call(() => pomodoroApi.start(m, l, tk)); },
    pause: () => call(pomodoroApi.pause),
    resume: () => { unlockAudio(); return call(pomodoroApi.resume); },
    reset: () => call(pomodoroApi.reset),
    skip: () => call(pomodoroApi.skip),
    setPhase: (p) => call(() => pomodoroApi.setPhase(p)),
    associate: (m, l, tk) => call(() => pomodoroApi.associate(m, l, tk)),
    saveSettings: async (s) => {
      const row = await pomodoroApi.saveSettings(s);
      setSettings(row); setSettingsSaved(true); await sync(); return row;
    },
  };
  return <TimerCtx.Provider value={value}>{children}</TimerCtx.Provider>;
}
