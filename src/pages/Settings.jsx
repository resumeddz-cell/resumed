import { sectionInfo } from '../lib/years.js';
import React, { useEffect, useState } from 'react';
import { LuLogOut, LuSave, LuGraduationCap } from 'react-icons/lu';
import { useAuth } from '../state/auth.jsx';
import { useTimer, playChime } from '../state/timer.jsx';
import { profileApi, errorMessage } from '../lib/api.js';
import { auth } from '../lib/supabase.js';
import { navigate } from '../lib/router.js';
import { useToast } from '../state/toast.jsx';
import { PageHeader, Field, Loader } from '../components/ui.jsx';
import { fmtDateTime } from '../lib/dates.js';

const LIMITS = { focus_minutes: [1, 180], short_break_minutes: [1, 60], long_break_minutes: [1, 120], sessions_before_long_break: [2, 12] };

export default function SettingsPage() {
  const { profile, setProfile, signOut } = useAuth();
  const tm = useTimer();
  const toast = useToast();
  const [name, setName] = useState(profile.display_name || '');
  const [savingName, setSavingName] = useState(false);
  const [pomo, setPomo] = useState(null);
  const [savingPomo, setSavingPomo] = useState(false);
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [savingPw, setSavingPw] = useState(false);

  useEffect(() => { if (tm.settings && !pomo) setPomo({ ...tm.settings }); }, [tm.settings]); // eslint-disable-line

  const saveName = async (e) => {
    e.preventDefault(); setSavingName(true);
    try { setProfile(await profileApi.update({ display_name: name.trim() || null })); toast.ok('Display name saved'); }
    catch (x) { toast.error(`Not saved: ${errorMessage(x)}`); } finally { setSavingName(false); }
  };
  const pomoErr = pomo && Object.entries(LIMITS).find(([k, [a, b]]) => !(Number.isInteger(Number(pomo[k])) && pomo[k] >= a && pomo[k] <= b));
  const savePomo = async (e) => {
    e.preventDefault(); if (pomoErr) return; setSavingPomo(true);
    try {
      await tm.saveSettings({
        focus_minutes: Number(pomo.focus_minutes), short_break_minutes: Number(pomo.short_break_minutes),
        long_break_minutes: Number(pomo.long_break_minutes), sessions_before_long_break: Number(pomo.sessions_before_long_break),
        sound_enabled: !!pomo.sound_enabled,
      });
      toast.ok(tm.timer && tm.timer.status !== 'idle' ? 'Saved — new durations apply from the next session' : 'Pomodoro settings saved');
    } catch (x) { toast.error(`Not saved: ${errorMessage(x)}`); } finally { setSavingPomo(false); }
  };
  const savePw = async (e) => {
    e.preventDefault(); if (pw.length < 8 || pw !== pw2) return; setSavingPw(true);
    try { await auth.updatePassword(pw); setPw(''); setPw2(''); toast.ok('Password changed'); }
    catch (x) { toast.error(`Password not changed: ${x.message}`); } finally { setSavingPw(false); }
  };
  const num = (k) => (e) => setPomo((p) => ({ ...p, [k]: e.target.value === '' ? '' : Number(e.target.value) }));

  return (
    <div className="page settings">
      <PageHeader title="Settings" subtitle="Small steps, big dreams" hero="art/notes_pens.webp" />
      <div className="settings-grid">
        <section className="card">
          <h2 className="h3">Profile</h2>
          <form onSubmit={saveName} className="form-grid">
            <Field label="Display name"><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
            <button className="btn btn-primary" disabled={savingName}><LuSave aria-hidden /> {savingName ? 'Saving…' : 'Save'}</button>
          </form>
          <button className="btn mt" onClick={() => navigate('/year')}><LuGraduationCap aria-hidden /> Change academic year / semester</button>
        </section>

        <section className="card">
          <h2 className="h3">Pomodoro</h2>
          {!pomo ? <Loader /> : (
            <form onSubmit={savePomo} className="form-grid">
              <div className="two">
                <Field label="Focus (minutes)"><input type="number" min={1} max={180} value={pomo.focus_minutes} onChange={num('focus_minutes')} /></Field>
                <Field label="Short break (minutes)"><input type="number" min={1} max={60} value={pomo.short_break_minutes} onChange={num('short_break_minutes')} /></Field>
              </div>
              <div className="two">
                <Field label="Long break (minutes)"><input type="number" min={1} max={120} value={pomo.long_break_minutes} onChange={num('long_break_minutes')} /></Field>
                <Field label="Focus sessions before a long break"><input type="number" min={2} max={12} value={pomo.sessions_before_long_break} onChange={num('sessions_before_long_break')} /></Field>
              </div>
              <label className="check-line"><input type="checkbox" checked={!!pomo.sound_enabled} onChange={(e) => setPomo((p) => ({ ...p, sound_enabled: e.target.checked }))} /> Play a sound when a session ends</label>
              {pomoErr && <p className="form-error">Please enter whole numbers within the allowed ranges.</p>}
              <div className="row gap wrap">
                <button className="btn btn-primary" disabled={savingPomo || !!pomoErr}><LuSave aria-hidden /> {savingPomo ? 'Saving…' : 'Save'}</button>
                <button type="button" className="btn" onClick={playChime}>Test sound</button>
                <button type="button" className="btn btn-ghost" onClick={() => setPomo((p) => ({ ...p, focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, sessions_before_long_break: 4 }))}>Default durations (25/5/15)</button>
              </div>
              {!tm.settingsSaved && <p className="muted small">Using the default durations. Your choice is stored once you press Save.</p>}
            </form>
          )}
        </section>

        <section className="card">
          <h2 className="h3">Account</h2>
          <dl className="kv-list">
            <div><dt>E-mail</dt><dd>{profile.email}</dd></div>
            <div><dt>Role</dt><dd>{profile.role === 'admin' ? 'Administrator' : 'Student'}</dd></div>
            <div><dt>Status</dt><dd><span className={`badge ${profile.status}`}>{profile.status}</span></dd></div>
            <div><dt>Member since</dt><dd>{fmtDateTime(profile.created_at)}</dd></div>
            <div><dt>Academic year</dt><dd>{profile.selected_year ? `Year ${profile.selected_year}${profile.selected_semester ? ` · ${sectionInfo(profile.selected_semester, profile.selected_year).short}` : ''}` : '—'}</dd></div>
          </dl>
          <h3 className="h4 mt">Change password</h3>
          <form onSubmit={savePw} className="form-grid">
            <Field label="New password" hint="At least 8 characters." error={pw && pw.length < 8 ? 'At least 8 characters.' : null}>
              <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="Confirm new password" error={pw2 && pw !== pw2 ? 'The two passwords do not match.' : null}>
              <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
            <button className="btn" disabled={savingPw || pw.length < 8 || pw !== pw2}>{savingPw ? 'Saving…' : 'Change password'}</button>
          </form>
          <button className="btn btn-pink mt" onClick={signOut}><LuLogOut aria-hidden /> Log out</button>
          <p className="muted small">Logging out ends this session only. Your saved progress stays in your account.</p>
        </section>
      </div>
    </div>
  );
}
