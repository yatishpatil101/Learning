import { useState, useRef, useLayoutEffect, useEffect, useCallback, cloneElement, isValidElement } from 'react';
import { createPortal } from 'react-dom';
import { tipFor } from '../../data/optionInfo.js';

/**
 * Tip — wraps a single element (an option tile/row) and reveals a small popover
 * explaining what that option means. No visible affordance is added: the wrapped
 * element itself is the trigger (hover on desktop, keyboard focus, tap on touch).
 *
 * Usage: <Tip k="keydetail.bedrooms">{tileJSX}</Tip>  (or pass explicit title/body)
 *
 * The child is cloned (not wrapped in an extra DOM node) so grid/flex layout is
 * untouched. The popover renders in a portal with fixed positioning so it is never
 * clipped by a card's overflow or z-index.
 */
export default function Tip({ k, title, body, children }) {
  const info = k ? tipFor(k) : (title || body ? { title, body } : null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const anchorRef = useRef(null);
  const tipRef = useRef(null);
  const idRef = useRef('pn-tip-' + Math.random().toString(36).slice(2, 9));
  const id = idRef.current;

  // Touch-only devices report `hover: none` — there we open on tap instead of hover/focus.
  const canHover = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(hover: hover)').matches : true;

  const place = useCallback(() => {
    const a = anchorRef.current;
    const t = tipRef.current;
    if (!a || !t) return;
    const r = a.getBoundingClientRect();
    const tw = t.offsetWidth;
    const th = t.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const above = r.top > th + 12;
    const top = above ? r.top - th - 8 : Math.min(r.bottom + 8, vh - th - 8);
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, vw - tw - 8));
    setPos({ top, left, above });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => { if (anchorRef.current && !anchorRef.current.contains(e.target)) setOpen(false); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  if (!info || (!info.title && !info.body) || !isValidElement(children)) return children || null;

  const setRef = (node) => {
    anchorRef.current = node;
    const r = children.ref;
    if (typeof r === 'function') r(node);
    else if (r && typeof r === 'object') r.current = node;
  };

  const trigger = cloneElement(children, {
    ref: setRef,
    'data-tip': '',
    tabIndex: children.props.tabIndex ?? 0,
    'aria-describedby': open ? id : undefined,
    onPointerEnter: (e) => { children.props.onPointerEnter?.(e); if (e.pointerType === 'mouse') setOpen(true); },
    onPointerLeave: (e) => { children.props.onPointerLeave?.(e); if (e.pointerType === 'mouse') setOpen(false); },
    onFocus: (e) => { children.props.onFocus?.(e); if (canHover) setOpen(true); },
    onBlur: (e) => { children.props.onBlur?.(e); setOpen(false); },
    onClick: (e) => { children.props.onClick?.(e); if (!canHover) setOpen((v) => !v); },
  });

  return (
    <>
      {trigger}
      {open ? createPortal(
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          className="pn-tip"
          style={pos
            ? { top: pos.top, left: pos.left, visibility: 'visible' }
            : { top: 0, left: 0, visibility: 'hidden' }}
        >
          {info.title ? <p className="pn-tip-title">{info.title}</p> : null}
          {info.body ? <p className="pn-tip-body">{info.body}</p> : null}
        </div>,
        document.body,
      ) : null}
    </>
  );
}
