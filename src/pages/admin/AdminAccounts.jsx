import React, { useCallback, useEffect, useState } from 'react';
import { LuSearch, LuCheck, LuX, LuPause, LuPlay, LuRefreshCw, LuBookOpen } from 'react-icons/lu';
import { adminApi, errorMessage } from '../../lib/api.js';
import { useToast } from '../../state/toast.jsx';
import { navigate } from '../../lib/router.js';
import { fmtDateTime } from '../../lib/dates.js';
import { Loader, ErrorBox, PageHeader } from '../../components/ui.jsx';

const STATUSES = [['', 'All statuses'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['suspended', 'Suspended']];
const ACTIONS = {
  pending: [['approved', 'Approve', LuCheck, 'btn-primary'], ['rejected', 'Reject', LuX, 'btn-ghost-danger']],
  rejected: [['approved', 'Approve', LuCheck, 'btn-primary']],
  approved: [['suspended', 'Suspend', LuPause, 'btn-ghost-danger']],
  suspended: [['approved', 'Reactivate', LuPlay, 'btn-primary']],
};

export default function AdminAccounts() {
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState(null);
  const [audit, setAudit] = useState([]);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, list, a] = await Promise.all([adminApi.stats(), adminApi.profiles({ search, status }), adminApi.audit()]);
      setStats(s); setRows(list); setAudit(a);
    } catch (e) { setErr(e); }
  }, [search, status]);
  useEffect(() => { const id = setTimeout(load, 250); return () => clearTimeout(id); }, [load]);
  // new registrations appear without a manual refresh
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') load(); };
    const id = setInterval(on, 30000);
    document.addEventListener('visibilitychange', on); window.addEventListener('focus', on);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', on); window.removeEventListener('focus', on); };
  }, [load]);

  const act = async (row, to) => {
    setConfirm(null); setBusy(row.id);
    try {
      const updated = await adminApi.setStatus(row.id, to);
      setRows((rs) => rs.map((r) => (r.id === row.id ? updated : r)).filter((r) => !status || r.status === status));
      setStats(await adminApi.stats()); setAudit(await adminApi.audit());
      toast.ok(`${row.email}: ${to === 'approved' ? (row.status === 'suspended' ? 'reactivated' : 'approved') : to}`);
    } catch (e) { toast.error(`Not changed: ${errorMessage(e)}`); }
    finally { setBusy(null); }
  };

  const tiles = [['', 'Total users', stats && stats.total], ['pending', 'Pending', stats && stats.pending], ['approved', 'Approved', stats && stats.approved],
    ['rejected', 'Rejected', stats && stats.rejected], ['suspended', 'Suspended', stats && stats.suspended]];

  return (
    <div className="page admin">
      <PageHeader title="Administrator" subtitle="Registrations and access" hero="art/clipboard.webp">
        <div className="row gap wrap"><button className="btn btn-small" onClick={() => navigate('/admin/curriculum')}><LuBookOpen aria-hidden /> Manage modules & lessons</button></div>
      </PageHeader>
      {err && <ErrorBox error={err} onRetry={load} title="Admin data could not be loaded" />}
      <div className="admin-tiles">
        {tiles.map(([k, label, v]) => (
          <button key={label} className={`stat card admin-tile tile-${k || 'all'} ${status === k ? 'active' : ''}`} onClick={() => setStatus(k)}>
            <span className="stat-value">{v === null || v === undefined ? '…' : v}</span><span className="stat-label">{label}</span>
          </button>
        ))}
      </div>
      <div className="card admin-filters">
        <div className="input-icon grow"><LuSearch aria-hidden /><input type="search" placeholder="Search by e-mail" aria-label="Search by e-mail" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="icon-btn" aria-label="Refresh" onClick={load}><LuRefreshCw /></button>
      </div>
      {!rows ? <Loader /> : rows.length === 0 ? <p className="muted center">No account matches.</p> : (
        <div className="table-wrap card"><table className="table accounts">
          <thead><tr><th>E-mail</th><th>Registered</th><th>Status</th><th>Last decision</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td data-label="E-mail"><strong>{r.email}</strong>{r.display_name && <div className="muted small">{r.display_name}</div>}</td>
              <td data-label="Registered">{fmtDateTime(r.created_at)}</td>
              <td data-label="Status"><span className={`badge ${r.status}`}>{r.role === 'admin' ? 'admin' : r.status}</span></td>
              <td data-label="Last decision">{r.status_changed_at ? fmtDateTime(r.status_changed_at) : '—'}</td>
              <td data-label="Actions" className="actions">
                {r.role === 'admin' ? <span className="muted small">Administrator</span>
                  : confirm && confirm.id === r.id ? (
                    <span className="row gap"><span className="small">{confirm.label} {r.email}?</span>
                      <button className="btn btn-small btn-danger" onClick={() => act(r, confirm.to)}>Confirm</button>
                      <button className="btn btn-small" onClick={() => setConfirm(null)}>Cancel</button></span>
                  ) : (ACTIONS[r.status] || []).map(([to, label, Icon, cls]) => (
                    <button key={to} className={`btn btn-small ${cls}`} disabled={busy === r.id}
                            onClick={() => (to === 'approved' ? act(r, to) : setConfirm({ id: r.id, to, label }))}><Icon aria-hidden /> {label}</button>
                  ))}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <section className="card">
        <h2 className="h3">Recent decisions</h2>
        {audit.length === 0 ? <p className="muted">No decisions yet.</p> : (
          <ul className="audit">{audit.map((a) => (
            <li key={a.id}><span className="muted small">{fmtDateTime(a.created_at)}</span> <strong>{a.target_email}</strong>: {a.old_status} → <span className={`badge ${a.new_status}`}>{a.new_status}</span></li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
