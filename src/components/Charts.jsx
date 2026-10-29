import React, { useState } from 'react';

// Lightweight SVG charts. Values come straight from saved data; zero is drawn as zero.
export function BarChart({ data, height = 180, format = (v) => v, unit = '', color = 'var(--teal-600)', highlightLast = false, ariaLabel }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = niceMax(max);
  const W = 640; const H = height; const padL = 36; const padB = 26; const padT = 12;
  const bw = (W - padL - 8) / data.length;
  const y = (v) => padT + (H - padT - padB) * (1 - v / nice);
  const ticks = [0, nice / 2, nice];
  return (
    <figure className="chart" aria-label={ariaLabel}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={padL} x2={W - 4} y1={y(tk)} y2={y(tk)} className="grid" />
            <text x={padL - 6} y={y(tk) + 4} className="axis" textAnchor="end">{format(tk)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * bw + bw * 0.18; const w = bw * 0.64; const top = y(d.value);
          const isHi = hover === i || (highlightLast && i === data.length - 1);
          return (
            <g key={d.key || i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              <rect x={x} y={top} width={w} height={Math.max(0, H - padB - top)} rx={Math.min(6, w / 3)}
                    fill={color} opacity={isHi ? 1 : 0.78} />
              <text x={x + w / 2} y={H - 8} className="axis" textAnchor="middle">{d.label}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <figcaption className="chart-tip">{data[hover].title || data[hover].label}: <strong>{format(data[hover].value)}{unit}</strong></figcaption>
      )}
      <table className="sr-only"><tbody>{data.map((d, i) => <tr key={i}><td>{d.title || d.label}</td><td>{format(d.value)}{unit}</td></tr>)}</tbody></table>
    </figure>
  );
}

export function LineChart({ data, height = 180, format = (v) => v, color = 'var(--pink-500)', ariaLabel }) {
  const W = 640; const H = height; const padL = 36; const padB = 26; const padT = 12;
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const x = (i) => padL + (data.length <= 1 ? 0 : (i * (W - padL - 12)) / (data.length - 1));
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const every = Math.max(1, Math.ceil(data.length / 8));
  return (
    <figure className="chart" aria-label={ariaLabel}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
        {[0, max / 2, max].map((tk) => (
          <g key={tk}><line x1={padL} x2={W - 4} y1={y(tk)} y2={y(tk)} className="grid" />
            <text x={padL - 6} y={y(tk) + 4} className="axis" textAnchor="end">{format(tk)}</text></g>
        ))}
        {data.length > 1 && <polygon points={`${x(0)},${y(0)} ${pts} ${x(data.length - 1)},${y(0)}`} fill={color} opacity="0.12" />}
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
        {data.map((d, i) => (i % every === 0 || i === data.length - 1) && (
          <text key={i} x={x(i)} y={H - 8} className="axis" textAnchor="middle">{d.label}</text>
        ))}
        {data.length > 0 && <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].value)} r="4.5" fill={color} />}
      </svg>
      <table className="sr-only"><tbody>{data.map((d, i) => <tr key={i}><td>{d.label}</td><td>{format(d.value)}</td></tr>)}</tbody></table>
    </figure>
  );
}

export function SplitBar({ parts, ariaLabel }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div className="split" aria-label={ariaLabel}>
      <div className="split-bar">
        {total === 0 ? <span className="split-empty" /> : parts.map((p) => (
          <span key={p.label} style={{ width: `${(100 * p.value) / total}%`, background: p.color }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <div className="split-legend">
        {parts.map((p) => (
          <span key={p.label}><i style={{ background: p.color }} />{p.label} <strong>{p.value}</strong></span>
        ))}
      </div>
    </div>
  );
}

function niceMax(v) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
