import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LuPlus, LuSearch, LuTrash2, LuArrowLeft, LuTriangleAlert } from 'react-icons/lu';
import { notesApi, currentUserId, errorMessage } from '../lib/api.js';
import { useAutosave, drafts } from '../lib/autosave.js';
import { fmtDateTime } from '../lib/dates.js';
import { navigate } from '../lib/router.js';
import { useToast } from '../state/toast.jsx';
import { Loader, ErrorBox, SaveStatus, Empty } from '../components/ui.jsx';

const SORTS = [['updated', 'Last modified'], ['created', 'Date created'], ['title', 'Title A–Z']];

function Editor({ note, onSaved, onDeleted }) {
  const uid = currentUserId();
  const draftKey = `resumed.draft.note.${uid}.${note.id}`;
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [conflict, setConflict] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const version = useRef(note.version);
  const toast = useToast();

  const save = useCallback(async (payload) => {
    const row = await notesApi.update(note.id, version.current, payload);
    version.current = row.version; drafts.clear(draftKey); onSaved(row);
  }, [note.id, draftKey, onSaved]);
  const auto = useAutosave(save, 800);

  useEffect(() => {   // restore a draft that never reached the database
    const d = drafts.get(draftKey);
    if (d && d.baseVersion === note.version && (d.title !== note.title || d.content !== note.content)) {
      setTitle(d.title); setContent(d.content); auto.schedule({ title: d.title, content: d.content });
      toast.info('Restored unsaved changes — saving them now.');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (auto.status === 'conflict') setConflict(auto.error && auto.error.details);
    if (auto.status === 'error' && auto.error && auto.error.code === 'gone') { toast.error('This note was deleted on another device.'); }
  }, [auto.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (patch) => {
    const next = { title, content, ...patch };
    if ('title' in patch) setTitle(patch.title); if ('content' in patch) setContent(patch.content);
    drafts.set(draftKey, { ...next, baseVersion: version.current });
    auto.schedule(next);
  };
  const keepMine = () => { if (conflict) version.current = conflict.version; setConflict(null); auto.schedule({ title, content }); auto.flush(); };
  const takeTheirs = () => {
    if (!conflict) return;
    auto.discard(); drafts.clear(draftKey);
    version.current = conflict.version; setTitle(conflict.title); setContent(conflict.content); setConflict(null); onSaved(conflict);
  };
  const del = async () => {
    try { auto.discard(); await notesApi.remove(note.id); drafts.clear(draftKey); onDeleted(note.id); toast.ok('Note deleted'); }
    catch (e) { toast.error(`Not deleted: ${errorMessage(e)}`); }
  };

  return (
    <section className="card note-editor">
      <div className="row between wrap">
        <button className="btn btn-small mobile-only" onClick={() => navigate('/notes')}><LuArrowLeft aria-hidden /> All notes</button>
        <SaveStatus status={auto.status === 'conflict' ? 'error' : auto.status} onRetry={() => auto.flush()} />
        {confirmDel
          ? <span className="row gap"><span className="small">Delete this note?</span><button className="btn btn-small btn-danger" onClick={del}>Delete</button>
              <button className="btn btn-small" onClick={() => setConfirmDel(false)}>Keep</button></span>
          : <button className="icon-btn" aria-label="Delete note" onClick={() => setConfirmDel(true)}><LuTrash2 /></button>}
      </div>
      {conflict && (
        <div className="notice notice-warn" role="alert"><LuTriangleAlert aria-hidden /> This note was changed on another device.
          <div className="row gap wrap"><button className="btn btn-small btn-primary" onClick={keepMine}>Keep my version</button>
            <button className="btn btn-small" onClick={takeTheirs}>Load the other version</button></div></div>
      )}
      <input className="note-title" aria-label="Note title" placeholder="Title" value={title} maxLength={300}
             onChange={(e) => edit({ title: e.target.value })} onBlur={() => auto.flush()} />
      <p className="muted small">Created {fmtDateTime(note.created_at)} · Modified {fmtDateTime(note.updated_at)}</p>
      <textarea className="lined note-body" aria-label="Note content" placeholder="Notes :" value={content}
                onChange={(e) => edit({ content: e.target.value })} onBlur={() => auto.flush()} />
    </section>
  );
}

export default function NotesPage({ id }) {
  const [notes, setNotes] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('updated');
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => { setErr(null); try { setNotes(await notesApi.list()); } catch (e) { setErr(e); } }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    if (!notes) return [];
    const needle = q.trim().toLowerCase();
    const list = needle ? notes.filter((n) => `${n.title}\n${n.content}`.toLowerCase().includes(needle)) : notes.slice();
    const cmp = {
      updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
      created: (a, b) => b.created_at.localeCompare(a.created_at),
      title: (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }),
    }[sort];
    return list.sort(cmp);
  }, [notes, q, sort]);

  const create = async () => {
    setCreating(true);
    try { const n = await notesApi.create('', ''); setNotes((xs) => [n, ...xs]); navigate(`/notes/${n.id}`); }
    catch (e) { toast.error(`Note not created: ${errorMessage(e)}`); } finally { setCreating(false); }
  };
  const onSaved = useCallback((row) => setNotes((xs) => xs.map((x) => (x.id === row.id ? row : x))), []);
  const onDeleted = (nid) => { setNotes((xs) => xs.filter((x) => x.id !== nid)); navigate('/notes'); };

  if (err) return <ErrorBox error={err} onRetry={load} title="Notes could not be loaded" />;
  if (!notes) return <Loader />;
  const current = id ? notes.find((n) => n.id === id) : null;

  return (
    <div className={`page notes-page ${current ? 'has-current' : ''}`}>
      <header className="notes-head">
        <img src="assets/art/notes_books.webp" alt="" className="notes-deco" />
        <h1 className="ph-title"><span className="brush">My Notes</span></h1>
        <img src="assets/art/notes_pens.webp" alt="" className="notes-deco" />
      </header>
      <div className="notes-grid">
        <aside className="notes-list card">
          <div className="row gap">
            <div className="input-icon grow"><LuSearch aria-hidden /><input type="search" placeholder="Search notes" aria-label="Search notes" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <button className="btn btn-primary" onClick={create} disabled={creating} aria-label="New note"><LuPlus aria-hidden /> New</button>
          </div>
          <select aria-label="Sort notes" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {notes.length === 0 ? <p className="muted">No notes yet. Create your first one!</p>
            : visible.length === 0 ? <p className="muted">No note matches “{q}”.</p> : (
            <ul>{visible.map((n) => (
              <li key={n.id}><button className={`note-item ${current && current.id === n.id ? 'active' : ''}`} onClick={() => navigate(`/notes/${n.id}`)}>
                <strong>{n.title || 'Untitled'}</strong>
                <span className="muted small clamp">{n.content.slice(0, 120) || 'Empty note'}</span>
                <span className="muted xsmall">{fmtDateTime(n.updated_at)}</span>
              </button></li>))}</ul>
          )}
        </aside>
        {current ? <Editor key={current.id} note={current} onSaved={onSaved} onDeleted={onDeleted} />
          : id ? <Empty title="Note not found">It may have been deleted.</Empty>
            : <div className="note-placeholder desktop-only"><img src="assets/art/notes_youcan.webp" alt="You can do it" /><p className="muted">Select a note or create a new one.</p></div>}
      </div>
    </div>
  );
}
