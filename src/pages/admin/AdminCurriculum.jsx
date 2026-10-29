import React, { useEffect, useState } from 'react';
import { LuPlus, LuPencil, LuTrash2, LuArrowUp, LuArrowDown, LuChevronDown, LuChevronRight, LuEye, LuEyeOff } from 'react-icons/lu';
import { adminApi, errorMessage } from '../../lib/api.js';
import { useCurriculum } from '../../state/data.jsx';
import { useToast } from '../../state/toast.jsx';
import { Loader, ErrorBox, PageHeader, Modal, Field, Img } from '../../components/ui.jsx';
import { SemesterTabs } from '../Modules.jsx';

function useIcons() {
  const [list, setList] = useState([]);
  useEffect(() => { fetch('assets/manifest.json').then((r) => r.json()).then(setList).catch(() => setList([])); }, []);
  return list;
}

function AssetPicker({ value, onChange, kind = 'icons' }) {
  const all = useIcons().filter((p) => p.startsWith(kind === 'icons' ? 'icons/' : 'art/'));
  return (
    <div className="asset-picker">
      <select value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— none —</option>{all.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      {value && <Img src={value} alt="" className="asset-preview" />}
    </div>
  );
}

function ModuleForm({ initial, parents, onClose, onSaved }) {
  const [f, setF] = useState({ title: '', description: '', icon: null, hero: null, active: true, parent_id: null, ...initial });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const save = async () => {
    setBusy(true); setErr(null);
    const payload = { title: f.title.trim(), description: f.description || null, icon: f.icon, hero: f.hero, active: f.active,
      parent_id: f.parent_id || null, semester: f.semester, year: 1 };
    try {
      const row = f.id ? await adminApi.updateModule(f.id, payload) : await adminApi.createModule({ ...payload, position: f.position || 999 });
      onSaved(row);
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  };
  return (
    <Modal open title={f.id ? 'Edit module' : 'New module'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy || !f.title.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-grid">
        <Field label="Title *"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></Field>
        <Field label="Description"><textarea rows={2} value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Parent (leave empty for a subject)">
          <select value={f.parent_id || ''} onChange={(e) => setF({ ...f, parent_id: e.target.value || null })}>
            <option value="">— top level ({f.semester}) —</option>
            {parents.filter((p) => p.id !== f.id).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        </Field>
        <Field label="Icon"><AssetPicker value={f.icon} onChange={(v) => setF({ ...f, icon: v })} /></Field>
        <Field label="Header illustration"><AssetPicker kind="art" value={f.hero} onChange={(v) => setF({ ...f, hero: v })} /></Field>
        <label className="check-line"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Visible to students</label>
        {err && <p className="form-error">Not saved: {err}</p>}
      </div>
    </Modal>
  );
}

function LessonForm({ initial, modules, onClose, onSaved }) {
  const [f, setF] = useState({ number: '', title: '', icon: null, note: '', active: true, ...initial });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const save = async () => {
    setBusy(true); setErr(null);
    const payload = { number: f.number || null, title: f.title.trim(), icon: f.icon, note: f.note || null, active: f.active, module_id: f.module_id };
    try {
      const row = f.id ? await adminApi.updateLesson(f.id, payload) : await adminApi.createLesson({ ...payload, position: f.position || 999 });
      onSaved(row);
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  };
  return (
    <Modal open title={f.id ? 'Edit lesson' : 'New lesson'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy || !f.title.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-grid">
        <div className="two">
          <Field label="Number (as printed)"><input value={f.number || ''} onChange={(e) => setF({ ...f, number: e.target.value })} maxLength={10} /></Field>
          <Field label="Module"><select value={f.module_id} onChange={(e) => setF({ ...f, module_id: e.target.value })}>
            {modules.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
        </div>
        <Field label="Title *"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={300} /></Field>
        <Field label="Icon"><AssetPicker value={f.icon} onChange={(v) => setF({ ...f, icon: v })} /></Field>
        <Field label="Note (shown to students)"><textarea rows={2} value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <label className="check-line"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (counted in progress)</label>
        {err && <p className="form-error">Not saved: {err}</p>}
      </div>
    </Modal>
  );
}

export default function AdminCurriculum() {
  const cur = useCurriculum();
  const toast = useToast();
  const [sem, setSem] = useState('S1');
  const [open, setOpen] = useState({});
  const [modForm, setModForm] = useState(null);
  const [lesForm, setLesForm] = useState(null);
  const [confirm, setConfirm] = useState(null);

  if (cur.error) return <ErrorBox error={cur.error} onRetry={cur.reload} />;
  if (!cur.ready) return <Loader />;
  const roots = cur.tree.roots.filter((r) => r.semester === sem);
  const flat = []; const walk = (n, p) => { const label = p ? `${p} › ${n.title}` : `${n.semester} · ${n.title}`; flat.push({ id: n.id, label, semester: n.semester }); n.children.forEach((c) => walk(c, label)); };
  cur.tree.roots.forEach((r) => walk(r, ''));

  const after = async (msg) => { await cur.reload(); toast.ok(msg); };
  const run = async (fn, msg) => { try { await fn(); await after(msg); } catch (e) { toast.error(errorMessage(e)); } };
  const move = (list, i, d, kind) => {
    const j = i + d; if (j < 0 || j >= list.length) return;
    const ids = list.map((x) => x.id); [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => (kind === 'module' ? adminApi.reorderModules(ids) : adminApi.reorderLessons(ids)), 'Order saved');
  };

  const renderModule = (n, siblings, i, depth) => (
    <li key={n.id} className={`adm-node depth-${depth} ${n.active ? '' : 'inactive'}`}>
      <div className="adm-row">
        <button className="icon-btn" aria-label={open[n.id] ? 'Collapse' : 'Expand'} onClick={() => setOpen({ ...open, [n.id]: !open[n.id] })}>
          {open[n.id] ? <LuChevronDown /> : <LuChevronRight />}</button>
        <span className="icon-circle sm"><Img src={n.icon} alt="" /></span>
        <strong className="grow">{n.title} {!n.active && <span className="badge suspended">hidden</span>}</strong>
        <span className="muted small">{n.lessons.length} lessons{n.children.length ? ` · ${n.children.length} chapters` : ''}{n.source_page ? ` · PDF p.${n.source_page}` : ''}</span>
        <span className="adm-actions">
          <button className="icon-btn" aria-label="Move up" onClick={() => move(siblings, i, -1, 'module')}><LuArrowUp /></button>
          <button className="icon-btn" aria-label="Move down" onClick={() => move(siblings, i, 1, 'module')}><LuArrowDown /></button>
          <button className="icon-btn" aria-label={n.active ? 'Hide from students' : 'Show to students'} onClick={() => run(() => adminApi.updateModule(n.id, { active: !n.active }), n.active ? 'Module hidden' : 'Module visible')}>{n.active ? <LuEye /> : <LuEyeOff />}</button>
          <button className="icon-btn" aria-label="Edit module" onClick={() => setModForm({ ...n })}><LuPencil /></button>
          <button className="icon-btn danger" aria-label="Delete module" onClick={() => setConfirm({ kind: 'module', item: n })}><LuTrash2 /></button>
        </span>
      </div>
      {open[n.id] && (
        <div className="adm-children">
          {n.children.length > 0 && <ul>{n.children.map((c, k) => renderModule(c, n.children, k, depth + 1))}</ul>}
          <ul className="adm-lessons">
            {n.lessons.map((l, k) => (
              <li key={l.id} className={l.active ? '' : 'inactive'}>
                <span className="icon-circle xs"><Img src={l.icon} alt="" /></span>
                <span className="grow">{l.number ? `${l.number}. ` : ''}{l.title} {!l.active && <span className="badge suspended">inactive</span>}</span>
                <span className="adm-actions">
                  <button className="icon-btn" aria-label="Move up" onClick={() => move(n.lessons, k, -1, 'lesson')}><LuArrowUp /></button>
                  <button className="icon-btn" aria-label="Move down" onClick={() => move(n.lessons, k, 1, 'lesson')}><LuArrowDown /></button>
                  <button className="icon-btn" aria-label="Edit lesson" onClick={() => setLesForm({ ...l })}><LuPencil /></button>
                  <button className="icon-btn danger" aria-label="Delete lesson" onClick={() => setConfirm({ kind: 'lesson', item: l })}><LuTrash2 /></button>
                </span>
              </li>
            ))}
          </ul>
          <div className="row gap wrap">
            <button className="btn btn-small" onClick={() => setLesForm({ module_id: n.id, position: n.lessons.length + 1 })}><LuPlus aria-hidden /> Add lesson</button>
            <button className="btn btn-small" onClick={() => setModForm({ parent_id: n.id, semester: n.semester, position: n.children.length + 1 })}><LuPlus aria-hidden /> Add chapter</button>
          </div>
        </div>
      )}
    </li>
  );

  return (
    <div className="page admin">
      <PageHeader title="Modules & lessons" subtitle="Changes apply instantly — no code changes needed" hero="art/feat_lessons.webp" back="/admin" />
      <SemesterTabs value={sem} onChange={setSem} />
      <p className="muted small">Tip: prefer <strong>hiding</strong> a module or making a lesson <strong>inactive</strong> over deleting it — deleting a lesson also deletes the students' completion records for it.</p>
      <ul className="adm-tree card">{roots.map((r, i) => renderModule(r, roots, i, 0))}</ul>
      <button className="btn btn-primary" onClick={() => setModForm({ semester: sem, position: roots.length + 1 })}><LuPlus aria-hidden /> New subject in {sem}</button>

      {modForm && <ModuleForm initial={modForm} parents={flat.filter((p) => p.semester === (modForm.semester || sem))} onClose={() => setModForm(null)}
                              onSaved={() => { setModForm(null); after('Module saved'); }} />}
      {lesForm && <LessonForm initial={lesForm} modules={flat} onClose={() => setLesForm(null)} onSaved={() => { setLesForm(null); after('Lesson saved'); }} />}
      {confirm && (
        <Modal open title={`Delete ${confirm.kind}?`} onClose={() => setConfirm(null)} footer={<>
          <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => { const c = confirm; setConfirm(null);
            run(() => (c.kind === 'module' ? adminApi.deleteModule(c.item.id) : adminApi.deleteLesson(c.item.id)), `${c.kind === 'module' ? 'Module' : 'Lesson'} deleted`); }}>Delete permanently</button></>}>
          <p><strong>{confirm.item.title}</strong></p>
          <p className="notice notice-warn">{confirm.kind === 'module'
            ? 'This deletes the module, all its chapters and lessons, and every student\'s completion records for them. This cannot be undone.'
            : 'This deletes the lesson and every student\'s completion record for it. This cannot be undone.'}</p>
        </Modal>
      )}
    </div>
  );
}
