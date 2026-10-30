import React, { useEffect, useRef } from 'react';
import { LuArrowLeft, LuRefreshCw, LuCheck, LuCloudOff, LuLoader } from 'react-icons/lu';
import { navigate } from '../lib/router.js';
import { fmtPct } from '../lib/progress.js';
import { t } from '../lib/i18n.js';

export const asset = (p) => (p ? `assets/${p}` : null);

export function Img({ src, alt = '', className = '', ...rest }) {
  if (!src) return null;
  // "badge:01" → a numbered badge (used for the Year 2 units, which have no illustration of their own)
  if (src.startsWith('badge:')) return <span className={`icon-badge ${className}`} aria-hidden>{src.slice(6)}</span>;
  return <img src={asset(src)} alt={alt} className={className} loading="lazy" decoding="async" {...rest} />;
}

export function Loader({ label = t('loading'), full = false }) {
  return (
    <div className={`loader ${full ? 'loader-full' : ''}`} role="status" aria-live="polite">
      <img src="assets/art/tomato.webp" alt="" className="loader-tomato" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry, title = 'Something went wrong' }) {
  return (
    <div className="card error-box" role="alert">
      <LuCloudOff aria-hidden size={28} />
      <div>
        <strong>{title}</strong>
        <p>{(error && error.message) || String(error || '')}</p>
      </div>
      {onRetry && <button className="btn" onClick={onRetry}><LuRefreshCw aria-hidden /> {t('retry')}</button>}
    </div>
  );
}

export function Empty({ title, children, art = 'mascot/mascot_wave_small.webp', action }) {
  return (
    <div className="empty card">
      <Img src={art} alt="" className="empty-art" />
      <div>
        <h3>{title}</h3>
        {children && <p className="muted">{children}</p>}
        {action}
      </div>
    </div>
  );
}

export function ProgressBar({ pct, label, size = 'md', tone = 'teal' }) {
  const v = pct === null || pct === undefined ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className={`pbar pbar-${size} pbar-${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100}
         aria-valuenow={pct === null ? undefined : v} aria-label={label}>
      <div className="pbar-fill" style={{ width: `${v}%` }} />
    </div>
  );
}

export function ProgressLine({ s, compact = false }) {
  if (!s) return null;
  if (s.total === 0) return <p className="muted small">No lessons yet</p>;
  return (
    <div className="progress-line">
      <ProgressBar pct={s.pct} label="Completion" />
      <div className="progress-meta">
        <strong className="pct">{fmtPct(s.pct)}</strong>
        {!compact && <span className="muted small">{s.learned} completed · {s.remaining} remaining</span>}
      </div>
    </div>
  );
}

export function SaveStatus({ status, onRetry }) {
  if (status === 'saving') return <span className="save-status saving"><LuLoader className="spin" aria-hidden /> {t('saving')}</span>;
  if (status === 'saved') return <span className="save-status saved"><LuCheck aria-hidden /> {t('saved')}</span>;
  if (status === 'error') return <button className="save-status failed" onClick={onRetry}>{t('saveFailed')}</button>;
  if (status === 'dirty') return <span className="save-status muted">Unsaved changes…</span>;
  return null;
}

export function PageHeader({ title, subtitle, hero, back, children, brand = true }) {
  return (
    <header className="page-header">
      <div className="ph-left">
        <div className="ph-top">
          {back && (
            <button className="icon-btn back" aria-label="Back" onClick={() => (typeof back === 'string' ? navigate(back) : window.history.back())}>
              <LuArrowLeft />
            </button>
          )}
          {brand && <img src="assets/art/logo_light.webp" alt="Resumed Planner" className="ph-brand" />}
        </div>
        <h1 className="ph-title"><span className="brush">{title}</span></h1>
        {subtitle && <p className="ph-sub">{subtitle}</p>}
        {children}
      </div>
      {hero && <Img src={hero} alt="" className="ph-hero" />}
    </header>
  );
}

export function Modal({ open, title, onClose, children, footer, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const el = ref.current; if (el) { const f = el.querySelector('input,textarea,select,button'); if (f) f.focus(); }
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); if (prev && prev.focus) prev.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label={t('close')} onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, error }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Stat({ label, value, sub, icon, tone = 'teal' }) {
  return (
    <div className={`stat card tone-${tone}`}>
      {icon && <div className="stat-icon" aria-hidden>{icon}</div>}
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-sub muted small">{sub}</div>}
      </div>
    </div>
  );
}

export function Slogan({ text = 'Petits pas, grands rêves !' }) {
  return <p className="slogan" aria-hidden>{text} ♡</p>;
}
