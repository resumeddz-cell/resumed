// Progress is ALWAYS computed from saved lesson_progress rows:
//   module % = lessons marked "Learned" / active lessons (including sub-modules) × 100
// Study time never influences completion.
export const STAGES = ['learned', 'revised1', 'revised2', 'qcm'];

export function buildTree(modules, lessons) {
  const nodes = new Map();
  modules.forEach((m) => nodes.set(m.id, { ...m, children: [], lessons: [] }));
  const roots = [];
  modules.forEach((m) => {
    const n = nodes.get(m.id);
    if (m.parent_id && nodes.has(m.parent_id)) nodes.get(m.parent_id).children.push(n);
    else if (!m.parent_id) roots.push(n);
  });
  lessons.forEach((l) => { const n = nodes.get(l.module_id); if (n) n.lessons.push(l); });
  const sort = (a, b) => (a.position - b.position) || String(a.title).localeCompare(String(b.title));
  nodes.forEach((n) => { n.children.sort(sort); n.lessons.sort(sort); });
  roots.sort(sort);
  return { nodes, roots };
}

export function progressMap(rows) {
  const m = new Map();
  (rows || []).forEach((r) => m.set(r.lesson_id, r));
  return m;
}

export function allLessons(node) {
  if (!node) return [];
  const own = (node.lessons || []).filter((l) => l.active !== false);
  return own.concat(...(node.children || []).filter((c) => c.active !== false).map(allLessons));
}

export function stats(lessons, pmap) {
  const total = lessons.length;
  const count = (stage) => lessons.reduce((n, l) => n + (pmap.get(l.id) && pmap.get(l.id)[stage] ? 1 : 0), 0);
  const learned = count('learned');
  return {
    total, learned, remaining: total - learned,
    revised1: count('revised1'), revised2: count('revised2'), qcm: count('qcm'),
    pct: total ? Math.round((learned / total) * 1000) / 10 : null,   // null => "no lessons yet" empty state
  };
}

export const moduleStats = (node, pmap) => stats(allLessons(node), pmap);

export function fmtPct(p) { return p === null || p === undefined ? '—' : `${Number.isInteger(p) ? p : p.toFixed(1)}%`; }
