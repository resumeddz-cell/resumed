import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { curriculumApi, errorMessage } from '../lib/api.js';
import { buildTree, progressMap } from '../lib/progress.js';
import { useToast } from './toast.jsx';

const DataCtx = createContext(null);
export const useCurriculum = () => useContext(DataCtx);

// Curriculum (shared) + this student's lesson progress (private). Loaded from the database;
// while loading, pages show a loader — never a misleading 0 %.
export function CurriculumProvider({ children }) {
  const toast = useToast();
  const [modules, setModules] = useState(null);
  const [lessons, setLessons] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState({});          // `${lessonId}:${stage}` -> true while saving

  const load = useCallback(async () => {
    try {
      setError(null);
      const [m, l, p] = await Promise.all([curriculumApi.modules(), curriculumApi.lessons(), curriculumApi.myProgress()]);
      setModules(m); setLessons(l); setRows(p);
    } catch (e) { setError(e); }
  }, []);

  useEffect(() => { load(); }, [load]);
  // keep devices in sync (and pick up admin changes): refetch when the tab comes back into view
  useEffect(() => {
    const on = () => {
      if (document.visibilityState !== 'visible') return;
      Promise.all([curriculumApi.modules(), curriculumApi.lessons(), curriculumApi.myProgress()])
        .then(([m, l, p]) => { setModules(m); setLessons(l); setRows(p); }).catch(() => {});
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const setStage = useCallback(async (lessonId, stage, value) => {
    const key = `${lessonId}:${stage}`;
    setPending((p) => ({ ...p, [key]: true }));
    try {
      const row = await curriculumApi.setStage(lessonId, stage, value);   // UI changes only after the DB confirms
      setRows((rs) => [...(rs || []).filter((r) => r.lesson_id !== lessonId), row]);
      return row;
    } catch (e) {
      toast.error(`Not saved: ${errorMessage(e)}`, { action: 'Retry', onAction: () => setStage(lessonId, stage, value) });
      throw e;
    } finally {
      setPending((p) => { const n = { ...p }; delete n[key]; return n; });
    }
  }, [toast]);

  const value = useMemo(() => {
    const ready = modules !== null && lessons !== null && rows !== null;
    const tree = ready ? buildTree(modules, lessons) : null;
    return {
      ready, error, reload: load, modules, lessons, rows, tree,
      pmap: ready ? progressMap(rows) : new Map(), pending, setStage,
    };
  }, [modules, lessons, rows, error, load, pending, setStage]);
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
