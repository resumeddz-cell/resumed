import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { pomodoroApi, sessionsApi, DEFAULT_POMODORO, errorMessage } from '../lib/api.js';
import { fmtClock } from '../lib/dates.js';
import { useToast } from './toast.jsx';

const TimerCtx = createContext(null);
export const useTimer = () => useContext(TimerCtx);
export const PHASE_LABEL = { focus: 'Focus', short_break: 'Short break', long_break: 'Long break' };

let audioCtx = null;
export function unlockAudio() {
  try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); }
  catch { /* audio unavailable */ }
}
export function playChime() {
  try {
    unlockAudio(); if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    [659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
      const s = t0 + i * 0.22; g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.25, s + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.6); o.start(s); o.stop(s + 0.65);
    });
  } catch { /* ignore */ }
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
      if (settingsRef.current && settingsRef.current.sound_enabled) playChime();
      toast.ok(payload.finished_phase === 'focus' ? 'Focus session complete — well done! Time for a break.' : 'Break over — ready for the next focus session?');
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
    settings, settingsSaved, completedToday,
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
