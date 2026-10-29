// Tiny hash router: works on any static host without server rewrites.
import { useEffect, useState } from 'react';

function current() {
  const h = window.location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path: path || '/', query: new URLSearchParams(qs || '') };
}
export function navigate(to, { replace = false } = {}) {
  const target = `#${to}`;
  if (replace) window.history.replaceState(null, '', target); else window.location.hash = to;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}
export function useRoute() {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const on = () => { setRoute(current()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
// match('/modules/:id', '/modules/abc') -> { id: 'abc' }
export function match(pattern, path) {
  const a = pattern.split('/').filter(Boolean); const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
