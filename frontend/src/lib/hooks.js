import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Marks EVERY failing field red, scrolls to + focuses the first via `data-err`, and returns the
// first message for a single toast.
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

  const cx = useCallback((name) => (errors[name] ? ' dz-invalid dz-shake' : ''), [errors]);

  return { errors, check, clear, clearAll, cx, has: (n) => !!errors[n], msg: (n) => errors[n] || '' };
}

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

const IN_PATTERN = /^[6-9]\d{9}$/;
export function useMobileInput(initial = '') {
  const [value, setRaw] = useState(() => String(initial).replace(/\D/g, '').slice(0, 10));
  const setValue = useCallback((v) => setRaw(String(v).replace(/\D/g, '').slice(0, 10)), []);
  const onChange = useCallback((e) => setValue(e.target.value), [setValue]);
  const valid = IN_PATTERN.test(value);
  return { value, setValue, onChange, valid, dial: '+91', maxLength: 10, inputMode: 'numeric' };
}

export const isValidMobile = (v) => IN_PATTERN.test(String(v || '').replace(/\D/g, ''));

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

// Keys are `dzDraft:*`. Snapshot-keyed debounce, `flush()` and the rule that changing a form's
// field shape means RENAMING its key: docs/system/cross-cutting.md
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

// Drop keys that must never reach disk — a verified-consent flag, an eligibility choice, a server
// id. Distinct from `ignore`, whose named fields are still saved and still restored.
function omitKeys(obj, omit) {
  if (!omit || !omit.length) return obj;
  const out = {};
  for (const k in obj) if (!omit.includes(k)) out[k] = obj[k];
  return out;
}

function flashDraftSaved() {
  if (typeof document === 'undefined') return;
  let s = document.getElementById('dzAutosaveSaved');
  if (!s) {
    s = document.createElement('div');
    s.id = 'dzAutosaveSaved';
    // Presentation lives in index.css (.dz-autosave-flash), never inline: a body-level node cannot
    // see `--dz-bottom-inset`, so a JS offset parks the pill on top of the mobile tab bar.
    s.className = 'dz-autosave-flash';
    const dot = document.createElement('span');
    dot.className = 'dz-autosave-flash__dot';
    s.appendChild(dot);
    s.appendChild(document.createTextNode(' Draft saved'));
    document.body.appendChild(s);
  }
  s.classList.add('is-on');
  clearTimeout(s._t);
  s._t = setTimeout(() => { s.classList.remove('is-on'); }, 1400);
}

export function useFormDraft(key, form, setForm, { debounce = 400, ignore = ['name', 'mobile'], omit = [], enabled = true } = {}) {
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

  /* Serialise during render and debounce on the RESULT: every caller rebuilds `form` each render,
     so keying on its identity would re-arm the timer forever and never write the draft. `omit` is
     applied HERE, at the only point anything reaches disk. */
  const snapshot = enabled ? JSON.stringify(omitKeys(form, omit)) : null;

  useEffect(() => {
    if (!enabled) return undefined;
    if (firstRun.current) { firstRun.current = false; return undefined; }
    if (cleared.current) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        // Judge the snapshot, not the form: a draft whose only content sits in an omitted field
        // would otherwise be written empty and then announce "Draft saved" over nothing.
        if (draftHasContent(omitKeys(form, omit), ignore)) { localStorage.setItem(key, snapshot); flashDraftSaved(); }
        else localStorage.removeItem(key);
      } catch {
        /* quota — non-blocking */
      }
    }, debounce);
    return () => clearTimeout(timer.current);
    // `snapshot` is `form`'s content: an unchanged string cannot reach disk differently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, snapshot, debounce, enabled]);

  const clear = useCallback(() => {
    cleared.current = true;
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    setRestored(false);
  }, [key]);

  /* Write the draft NOW: any gate that navigates away must call this, or the unmount cleanup
     cancels the pending debounced write and loses whatever was typed last. */
  const flush = () => {
    if (!enabled || cleared.current) return;
    clearTimeout(timer.current);
    try {
      if (draftHasContent(omitKeys(form, omit), ignore)) localStorage.setItem(key, snapshot);
      else localStorage.removeItem(key);
    } catch { /* quota — same non-blocking posture as the debounced save */ }
  };

  const startFresh = useCallback(() => {
    clear();
    if (typeof window !== 'undefined') window.location.reload();
  }, [clear]);

  return { restored, clear, flush, startFresh };
}
