import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* React ports of the prototype's form helpers (validation.js, mobile-input.js, autosave.js). */

// ---- useFieldErrors: inline red-field validation (port of validation.js PNValidate.check) ----
// Marks EVERY failing field red, scrolls to + focuses the first, and returns the first message
// for a single toast. Clears a field's red state as soon as the user edits it.
// Usage:
//   const err = useFieldErrors(formRef);
//   if (!err.check([{ name: 'name', ok: !!form.name.trim(), msg: 'Please enter your name' }], toast)) return;
//   <input className={fld + err.cx('name')} onChange={(e)=>{ set('name', e.target.value); err.clear('name'); }} data-err="name" />
export function useFieldErrors(formRef) {
  const [errors, setErrors] = useState({});

  const clear = useCallback((name) => setErrors((e) => {
    if (!e[name]) return e;
    const { [name]: _omit, ...rest } = e;
    return rest;
  }), []);

  const clearAll = useCallback(() => setErrors({}), []);

  const check = useCallback((specs, toast) => {
    const next = {};
    let firstName = null;
    let firstMsg = '';
    for (const s of specs || []) {
      if (!s) continue;
      const ok = typeof s.ok === 'function' ? !!s.ok() : !!s.ok;
      if (!ok) {
        next[s.name] = s.msg || 'Required';
        if (!firstName) { firstName = s.name; firstMsg = s.msg || 'Please complete the highlighted field(s)'; }
      }
    }
    setErrors(next);
    if (!firstName) return true;
    if (toast) toast(firstMsg, 'error');
    // Scroll to + focus the first invalid field on the next frame.
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const root = (formRef && formRef.current) || document;
        const el = root.querySelector('[data-err="' + firstName + '"]');
        if (el) {
          if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const focusable = el.matches('input,select,textarea,button,[tabindex]') ? el : el.querySelector('input,select,textarea,button,[tabindex]');
          if (focusable && focusable.focus) { try { focusable.focus({ preventScroll: true }); } catch { focusable.focus(); } }
        }
      });
    }
    return false;
  }, [formRef]);

  const cx = useCallback((name) => (errors[name] ? ' pn-invalid pn-shake' : ''), [errors]);

  return { errors, check, clear, clearAll, cx, has: (n) => !!errors[n], msg: (n) => errors[n] || '' };
}

// ---- useValidation: mark required fields, return whether all pass ----
export function useValidation() {
  const [errors, setErrors] = useState({});

  const validate = useCallback((rules) => {
    const next = {};
    for (const r of rules) {
      if (!r.ok) next[r.name] = r.msg || 'Required';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }, []);

  const clearField = useCallback((name) => setErrors((e) => {
    if (!e[name]) return e;
    const { [name]: _, ...rest } = e;
    return rest;
  }), []);

  const clearAll = useCallback(() => setErrors({}), []);

  return { errors, validate, clearField, clearAll, hasError: (n) => !!errors[n] };
}

// ---- useMobileInput: 10-digit Indian mobile, +91, strips non-digits ----
const IN_PATTERN = /^[6-9]\d{9}$/;
export function useMobileInput(initial = '') {
  const [value, setRaw] = useState(() => String(initial).replace(/\D/g, '').slice(0, 10));
  const setValue = useCallback((v) => setRaw(String(v).replace(/\D/g, '').slice(0, 10)), []);
  const onChange = useCallback((e) => setValue(e.target.value), [setValue]);
  const valid = IN_PATTERN.test(value);
  return { value, setValue, onChange, valid, dial: '+91', maxLength: 10, inputMode: 'numeric' };
}

export const isValidMobile = (v) => IN_PATTERN.test(String(v || '').replace(/\D/g, ''));

// ---- useAutosave: persist a form-state object to localStorage (debounced) ----
export function useAutosave(key, initialState, { debounce = 400 } = {}) {
  const [restored, setRestored] = useState(false);
  const [state, setState] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved && typeof saved === 'object') return { ...initialState, ...saved };
    } catch {
      /* ignore */
    }
    return initialState;
  });
  const timer = useRef(null);
  const firstRun = useRef(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved && saved !== JSON.stringify(initialState)) setRestored(true);
    } catch {
      /* ignore */
    }
    // initialState identity is intentionally read once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return undefined;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        /* ignore quota */
      }
    }, debounce);
    return () => clearTimeout(timer.current);
  }, [key, state, debounce]);

  const clear = useCallback(() => {
    localStorage.removeItem(key);
    setRestored(false);
  }, [key]);

  const update = useCallback((patch) => setState((s) => ({ ...s, ...patch })), []);

  return { state, setState, update, clear, restored };
}

// ---- useFormDraft: autosave/restore an EXTERNAL form-state object ----
// Mirrors the prototype's autosave.js: same `pnDraft:*` keys, a restored banner
// (via the returned `restored` flag) and a bottom-left "Draft saved" flash.
// Wraps a form's existing useState so pages need minimal changes.
function draftHasContent(obj, ignore) {
  return Object.keys(obj || {}).some((k) => {
    if (ignore && ignore.includes(k)) return false;
    const v = obj[k];
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'string') return v.trim() !== '';
    if (typeof v === 'number') return true;
    if (typeof v === 'boolean') return v;
    return v != null && v !== '';
  });
}

function flashDraftSaved() {
  if (typeof document === 'undefined') return;
  let s = document.getElementById('pnAutosaveSaved');
  if (!s) {
    s = document.createElement('div');
    s.id = 'pnAutosaveSaved';
    s.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2000;background:rgba(15,13,26,.92);border:1px solid rgba(20,184,166,.3);color:#5eead4;font-size:12px;font-weight:600;padding:7px 12px;border-radius:10px;display:flex;align-items:center;gap:6px;opacity:0;transition:opacity .3s;backdrop-filter:blur(8px);pointer-events:none';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#14b8a6;display:inline-block';
    s.appendChild(dot);
    s.appendChild(document.createTextNode(' Draft saved'));
    document.body.appendChild(s);
  }
  s.style.opacity = '1';
  clearTimeout(s._t);
  s._t = setTimeout(() => { s.style.opacity = '0'; }, 1400);
}

export function useFormDraft(key, form, setForm, { debounce = 400, ignore = ['name', 'mobile'], enabled = true } = {}) {
  const [restored, setRestored] = useState(false);
  const firstRun = useRef(true);
  const cleared = useRef(false);
  const timer = useRef(null);

  // Restore once on mount. Only fields the user actually filled override the
  // form's defaults — empty draft values must not wipe smart defaults.
  useEffect(() => {
    if (!enabled) return;
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved && typeof saved === 'object' && draftHasContent(saved, ignore)) {
        const nonEmptyFields = {};
        for (const k in saved) {
          const v = saved[k];
          const isEmpty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
          if (!isEmpty) nonEmptyFields[k] = v;
        }
        setForm((f) => ({ ...f, ...nonEmptyFields }));
        setRestored(true);
      }
    } catch {
      /* ignore malformed draft */
    }
    // key identity read once; setForm is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Debounced save on form change.
  useEffect(() => {
    if (!enabled) return undefined;
    if (firstRun.current) { firstRun.current = false; return undefined; }
    if (cleared.current) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        if (draftHasContent(form, ignore)) { localStorage.setItem(key, JSON.stringify(form)); flashDraftSaved(); }
        else localStorage.removeItem(key);
      } catch {
        /* quota — non-blocking */
      }
    }, debounce);
    return () => clearTimeout(timer.current);
  }, [key, form, debounce, enabled]);

  const clear = useCallback(() => {
    cleared.current = true;
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    setRestored(false);
  }, [key]);

  const startFresh = useCallback(() => {
    clear();
    if (typeof window !== 'undefined') window.location.reload();
  }, [clear]);

  return { restored, clear, startFresh };
}
