import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { classNames } from '../../lib/format.js';
import Icon from '../Icon.jsx';

/**
 * Compact overflow ("More") menu. A kebab trigger opens a small themed panel of
 * actions, portaled to <body> so it escapes any card overflow/stacking trap and
 * flips up near the viewport edge — the same anchoring approach as Select.
 *
 * @param {object} props
 * @param {Array<{icon?: string, label: string, onClick?: () => void, href?: string,
 *   to?: string, tone?: 'default'|'danger', disabled?: boolean, divider?: boolean}>} props.items
 * @param {string} [props.ariaLabel='More actions']
 * @param {string} [props.className] - Extra classes on the trigger.
 * @param {(to: string) => void} [props.onNavigate] - Called for items with `to` (router push).
 */
export default function Menu({ items = [], ariaLabel = 'More actions', className, onNavigate }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const inRoot = rootRef.current && rootRef.current.contains(e.target);
      const inMenu = menuRef.current && menuRef.current.contains(e.target);
      if (!inRoot && !inMenu) close();
    };
    const onKey = (e) => { if (e.key === 'Escape') { close(); triggerRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const position = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const r = trigger.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.zIndex = '9999';
    const mw = menu.offsetWidth;
    // Right-align the panel to the trigger so it opens inward from the row's edge.
    let left = r.right - mw;
    if (left < 8) left = 8;
    if (left + mw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - mw);
    menu.style.left = `${left}px`;
    let top = r.bottom + 6;
    const mh = menu.offsetHeight;
    if (top + mh > window.innerHeight - 8 && r.top - 6 - mh > 8) top = r.top - 6 - mh;
    menu.style.top = `${top}px`;
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    position();
    const onAnchor = () => position();
    window.addEventListener('scroll', onAnchor, true);
    window.addEventListener('resize', onAnchor);
    return () => {
      window.removeEventListener('scroll', onAnchor, true);
      window.removeEventListener('resize', onAnchor);
    };
  }, [open, position]);

  const pick = (it) => {
    close();
    if (it.disabled) return;
    if (it.to && onNavigate) onNavigate(it.to);
    else if (it.href) window.open(it.href, it.target || '_self', it.target === '_blank' ? 'noopener,noreferrer' : '');
    else if (it.onClick) it.onClick();
  };

  return (
    <div ref={rootRef} className={classNames('relative inline-flex', className)}>
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={classNames(
          'inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 transition-colors',
          'hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60',
          open && 'bg-white/10 text-white',
        )}
      >
        <Icon name="more-horizontal" className="w-4 h-4" />
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={ariaLabel}
              className="min-w-[11rem] max-w-[16rem] rounded-xl border border-white/10 bg-ink-2 p-1.5 shadow-2xl shadow-black/50"
            >
              {items.map((it, i) => {
                if (it.divider) return <div key={`d${i}`} className="my-1 h-px bg-white/[0.07]" role="separator" />;
                const danger = it.tone === 'danger';
                return (
                  <button
                    key={it.label + i}
                    type="button"
                    role="menuitem"
                    disabled={it.disabled}
                    onClick={() => pick(it)}
                    className={classNames(
                      'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium text-left transition-colors',
                      it.disabled && 'opacity-40 cursor-not-allowed',
                      !it.disabled && (danger
                        ? 'text-rose-300 hover:bg-rose-500/15'
                        : 'text-gray-200 hover:bg-white/[0.06] hover:text-white'),
                    )}
                  >
                    {it.icon ? <Icon name={it.icon} className={classNames('w-4 h-4 flex-shrink-0', danger ? 'text-rose-300' : 'text-gray-400')} /> : null}
                    <span className="truncate">{it.label}</span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
