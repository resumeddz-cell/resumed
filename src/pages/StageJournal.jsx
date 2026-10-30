import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LuPlus, LuSearch, LuTrash2, LuArrowLeft, LuTriangleAlert, LuCalendarDays, LuStethoscope, LuLightbulb, LuTrendingDown, LuTrendingUp } from 'react-icons/lu';
import { stageApi, currentUserId, errorMessage, STAGE_FIELDS } from '../lib/api.js';
import { useAutosave, drafts } from '../lib/autosave.js';
import { fmtDate, fmtDateTime, toISODate, today, parseISODate } from '../lib/dates.js';
import { navigate } from '../lib/router.js';
import { useToast } from '../state/toast.jsx';
import { Loader, ErrorBox, SaveStatus, Empty } from '../components/ui.jsx';

const pick = (row) => Object.fromEntries(STAGE_FIELDS.map((k) => [k, row[k] == null ? '' : row[k]]));
const dayLabel = (iso) => (iso ? fmtDate(parseISODate(iso), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '');

function Editor({ entry, stageNames, onSaved, onDeleted }) {
  const uid = currentUserId();
  const draftKey = `resumed.draft.stage.${uid}.${entry.id}`;
  const [f, setF] = useState(() => pick(entry));
  const [conflict, setConflict] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const version = useRef(entry.version);
  const toast = useToast();

  const save = useCallback(async (payload) => {
    const row = await stageApi.update(entry.id, version.current, payload);
    version.current = row.version; drafts.clear(draftKey); onSaved(row);
  }, [entry.id, draftKey, onSaved]);
  const auto = useAutosave(save, 800);

  useEffect(() => {   // restore a draft that never reached the database
    const d = drafts.get(draftKey);
    if (d && d.baseVersion === entry.version && STAGE_FIELDS.some((k) => d[k] !== undefined && d[k] !== pick(entry)[k])) {
      const next = pick({ ...entry, ...d }); setF(next); auto.schedule(next);
      toast.info('Restored unsaved changes — saving them now.');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (auto.status === 'conflict') setConflict(auto.error && auto.error.details);
    if (auto.status === 'error' && auto.error && auto.error.code === 'gone') toast.error('This entry was deleted on another device.');
  }, [auto.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (k) => (e) => {
    const next = { ...f, [k]: e.target.value };
    if (k === 'entry_date' && !next.entry_date) return;          // the date is required
    setF(next);
    drafts.set(draftKey, { ...next, baseVersion: version.current });
    auto.schedule(next);
  };
  const keepMine = () => { if (conflict) version.current = conflict.version; setConflict(null); auto.schedule(f); auto.flush(); };
  const takeTheirs = () => {
    if (!conflict) return;
    auto.discard(); drafts.clear(draftKey);
    version.current = conflict.version; setF(pick(conflict)); setConflict(null); onSaved(conflict);
  };
  const del = async () => {
    try { auto.discard(); await stageApi.remove(entry.id); drafts.clear(draftKey); onDeleted(entry.id); toast.ok('Entry deleted'); }
    catch (e) { toast.error(`Not deleted: ${errorMessage(e)}`); }
  };
  const blur = () => auto.flush();

  return (
    <section className="card note-editor stage-editor">
      <div className="row between wrap">
        <button className="btn btn-small mobile-only" onClick={() => navigate('/stages')}><LuArrowLeft aria-hidden /> All entries</button>
        <SaveStatus status={auto.status === 'conflict' ? 'error' : auto.status} onRetry={() => auto.flush()} />
        {confirmDel
          ? <span className="row gap"><span className="small">Delete this entry?</span><button className="btn btn-small btn-danger" onClick={del}>Delete</button>
              <button className="btn btn-small" onClick={() => setConfirmDel(false)}>Keep</button></span>
          : <button className="icon-btn" aria-label="Delete entry" onClick={() => setConfirmDel(true)}><LuTrash2 /></button>}
      </div>
      {conflict && (
        <div className="notice notice-warn" role="alert"><LuTriangleAlert aria-hidden /> This entry was changed on another device.
          <div className="row gap wrap"><button className="btn btn-small btn-primary" onClick={keepMine}>Keep my version</button>
            <button className="btn btn-small" onClick={takeTheirs}>Load the other version</button></div></div>
      )}

      <div className="stage-meta">
        <label className="field"><span className="field-label"><LuCalendarDays aria-hidden /> Date</span>
          <input type="date" value={f.entry_date} onChange={edit('entry_date')} onBlur={blur} required /></label>
        <label className="field grow"><span className="field-label"><LuStethoscope aria-hidden /> Stage (service, hôpital)</span>
          <input type="text" list="stage-names" placeholder="ex. Cardiologie — CHU" value={f.stage_name} maxLength={200} onChange={edit('stage_name')} onBlur={blur} />
          <datalist id="stage-names">{stageNames.map((n) => <option key={n} value={n} />)}</datalist></label>
      </div>
      <label className="field"><span className="field-label">Sujet du jour — c'était à propos de quoi ?</span>
        <input type="text" className="stage-topic" placeholder="ex. Examen cardiaque, cas d'insuffisance cardiaque…" value={f.topic} maxLength={500} onChange={edit('topic')} onBlur={blur} /></label>

      <label className="field stage-block learned"><span className="field-label"><LuLightbulb aria-hidden /> Ce que j'ai appris</span>
        <textarea className="lined" rows={7} placeholder="Ce que j'ai vu, compris, retenu aujourd'hui…" value={f.learned} onChange={edit('learned')} onBlur={blur} /></label>
      <div className="stage-two">
        <label className="field stage-block weak"><span className="field-label"><LuTrendingDown aria-hidden /> Mes points faibles</span>
          <textarea className="lined" rows={5} placeholder="Ce que je dois encore travailler…" value={f.weaknesses} onChange={edit('weaknesses')} onBlur={blur} /></label>
        <label className="field stage-block strong"><span className="field-label"><LuTrendingUp aria-hidden /> Mes points forts</span>
          <textarea className="lined" rows={5} placeholder="Ce que j'ai bien réussi…" value={f.strengths} onChange={edit('strengths')} onBlur={blur} /></label>
      </div>
      <p className="muted xsmall">Created {fmtDateTime(entry.created_at)} · Modified {fmtDateTime(entry.updated_at)}</p>
    </section>
  );
}

export default function StageJournalPage({ id }) {
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => { setErr(null); try { setEntries(await stageApi.list()); } catch (e) { setErr(e); } }, []);
  useEffect(() => { load(); }, [load]);

  const stageNames = useMemo(() => {
    const seen = new Map();
    (entries || []).forEach((e) => { const n = e.stage_name.trim(); if (n) seen.set(n, (seen.get(n) || 0) + 1); });
    return [...seen.entries()].map(([name, count]) => ({ name, count }));
  }, [entries]);

  const visible = useMemo(() => {
    if (!entries) return [];
    const needle = q.trim().toLowerCase();
    return entries
      .filter((e) => !stage || e.stage_name.trim() === stage)
      .filter((e) => !needle || STAGE_FIELDS.map((k) => e[k] || '').join('\n').toLowerCase().includes(needle))
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at));
  }, [entries, q, stage]);

  const create = async () => {
    setCreating(true);
    try {
      // a new day usually continues the same stage: pre-fill it from the latest entry
      const last = entries && entries[0];
      const row = await stageApi.create({ entry_date: toISODate(today()), stage_name: stage || (last ? last.stage_name : '') });
      setEntries((xs) => [row, ...xs]); navigate(`/stages/${row.id}`);
    } catch (e) { toast.error(`Entry not created: ${errorMessage(e)}`); } finally { setCreating(false); }
  };
  const onSaved = useCallback((row) => setEntries((xs) => xs.map((x) => (x.id === row.id ? row : x))), []);
  const onDeleted = (eid) => { setEntries((xs) => xs.filter((x) => x.id !== eid)); navigate('/stages'); };

  if (err) return <ErrorBox error={err} onRetry={load} title="Your carnet de stage could not be loaded" />;
  if (!entries) return <Loader />;
  const current = id ? entries.find((n) => n.id === id) : null;

  return (
    <div className={`page notes-page stage-page ${current ? 'has-current' : ''}`}>
      <header className="notes-head">
        <img src="assets/art/clipboard.webp" alt="" className="notes-deco" />
        <h1 className="ph-title"><span className="brush">Carnet de stage</span></h1>
        <img src="assets/art/notes_microscope.webp" alt="" className="notes-deco" />
      </header>
      <div className="notes-grid">
        <aside className="notes-list card">
          <div className="row gap">
            <div className="input-icon grow"><LuSearch aria-hidden /><input type="search" placeholder="Search" aria-label="Search the carnet de stage" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <button className="btn btn-primary" onClick={create} disabled={creating} aria-label="New day"><LuPlus aria-hidden /> New day</button>
          </div>
          {stageNames.length > 0 && (
            <select aria-label="Filter by stage" value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">All stages ({entries.length} {entries.length > 1 ? 'days' : 'day'})</option>
              {stageNames.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.count} {s.count > 1 ? 'days' : 'day'})</option>)}
            </select>
          )}
          {entries.length === 0 ? <p className="muted">No entry yet. After each stage day, add what you did, what you learned, your weak points and your strong points.</p>
            : visible.length === 0 ? <p className="muted">No entry matches.</p> : (
            <ul>{visible.map((n) => (
              <li key={n.id}><button className={`note-item ${current && current.id === n.id ? 'active' : ''}`} onClick={() => navigate(`/stages/${n.id}`)}>
                <span className="stage-item-date">{dayLabel(n.entry_date)}</span>
                <strong>{n.stage_name || 'Stage —'}</strong>
                <span className="muted small clamp">{n.topic || n.learned.slice(0, 120) || 'Empty entry'}</span>
              </button></li>))}</ul>
          )}
        </aside>
        {current ? <Editor key={current.id} entry={current} stageNames={stageNames.map((s) => s.name)} onSaved={onSaved} onDeleted={onDeleted} />
          : id ? <Empty title="Entry not found">It may have been deleted.</Empty>
            : <div className="note-placeholder desktop-only"><img src="assets/art/notes_youcan.webp" alt="You can do it" />
                <p className="muted">Select a day or add a new one.</p></div>}
      </div>
    </div>
  );
}
