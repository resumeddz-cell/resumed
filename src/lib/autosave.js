import { useCallback, useEffect, useRef, useState } from 'react';

// Debounced autosave. Shows "Saved" ONLY after the save promise resolves (i.e. the database confirmed).
// On failure the unsaved payload is kept and can be retried; nothing typed is ever discarded.
export function useAutosave(saveFn, delay = 900) {
  const [status, setStatus] = useState('idle');        // idle | dirty | saving | saved | error | conflict
  const [error, setError] = useState(null);
  const pending = useRef(null);
  const inflight = useRef(null);
  const timer = useRef(null);
  const fnRef = useRef(saveFn); fnRef.current = saveFn;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    if (!pending.current) return true;
    const payload = pending.current; pending.current = null;
    setStatus('saving');
    inflight.current = Promise.resolve()
      .then(() => fnRef.current(payload))
      .then(() => { if (!pending.current) setStatus('saved'); setError(null); return true; })
      .catch((e) => {
        if (!pending.current) pending.current = payload;           // keep the unsaved input
        setError(e);
        setStatus(e && (e.message === 'version_conflict' || e.code === 'version_conflict') ? 'conflict' : 'error');
        return false;
      })
      .finally(() => { inflight.current = null; });
    const ok = await inflight.current;
    if (ok && pending.current) return flush();                     // typed again while saving
    return ok;
  }, []);

  const schedule = useCallback((payload) => {
    pending.current = payload; setStatus('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { flush(); }, delay);
  }, [delay, flush]);

  const discard = useCallback(() => { clearTimeout(timer.current); pending.current = null; setStatus('idle'); setError(null); }, []);
  const busy = () => !!pending.current || !!inflight.current;

  // warn before closing the tab with unsaved changes
  useEffect(() => {
    const on = (e) => { if (busy()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', on);
    return () => { window.removeEventListener('beforeunload', on); clearTimeout(timer.current); };
  }, []);

  return { status, error, schedule, flush, discard, busy, setStatus };
}

// Local draft backup (best effort): protects typed text if the tab crashes before the save lands.
export const drafts = {
  get(key) { try { const v = window.localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(key, v) { try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  clear(key) { try { window.localStorage.removeItem(key); } catch { /* ignore */ } },
};
