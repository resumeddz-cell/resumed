import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);
  const dismiss = useCallback((id) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback((type, text, opts = {}) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-3), { id, type, text, ...opts }]);
    if (!opts.sticky) setTimeout(() => dismiss(id), opts.action ? 9000 : 4500);
    return id;
  }, [dismiss]);
  const api = useMemo(() => ({
    ok: (t, o) => push('ok', t, o), error: (t, o) => push('error', t, o), info: (t, o) => push('info', t, o), dismiss,
  }), [push, dismiss]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((x) => (
          <div key={x.id} className={`toast toast-${x.type}`}>
            <span>{x.text}</span>
            {x.action && <button className="btn btn-small" onClick={() => { dismiss(x.id); x.onAction(); }}>{x.action}</button>}
            <button className="toast-x" aria-label="Dismiss" onClick={() => dismiss(x.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
