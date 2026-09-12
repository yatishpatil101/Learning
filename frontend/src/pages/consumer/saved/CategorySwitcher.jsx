import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

/* CategorySwitcher — the shortlist's category switcher for phones (< sm).
   Replaces the tab strip, which put three pills (icon + label + count) across a
   360 px viewport: the labels truncated, "Flatmates & Rooms" had to be shortened
   to "Flatmates" to fit at all, and the per-category descriptions had nowhere to
   go. Here a single row shows the current category; tapping opens a bottom sheet
   listing EVERY category with its description and count, so nothing is truncated
   and the sizes of the other two shortlists are glanceable in one place.

   Deliberately the same component as the dashboard's MobileNav (see
   pages/consumer/dashboard/MobileNav.jsx) down to the markup: same trigger
   geometry, same dz-modal-panel / glass-card / brand-teal sheet, same focus and
   Escape handling. A second, subtly different sheet would be worse than the row
   this replaces. Tablet and desktop keep the pill strip unchanged.

   `data-no-ptr` on the overlay: Saved arms pull-to-refresh on the page root, and
   this sheet is a DOM descendant of it, so a downward drag inside the sheet would
   otherwise be read as an overscroll at the top of the page and fire a refetch —
   see lib/usePullToRefresh.js. */

export default function CategorySwitcher({ categories, activeKey, counts = {}, onSelect, labelFor, descFor }) {
  const { t: tr } = useTranslation();
  const CATEGORY_LABEL = tr('saved.categoryLabel');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const wasOpen = useRef(false);
  const headingId = useId();
  const active = useMemo(
    () => categories.find((c) => c.key === activeKey) || categories[0],
    [categories, activeKey],
  );

  // While the sheet is open, behave like a proper modal: close on Escape, keep Tab
  // focus inside the panel, and auto-focus its first control. On close, hand focus
  // back to the switcher so keyboard users never lose their place (WCAG 2.4.3).
  useEffect(() => {
    if (!open) {
      // Only pull focus back to the switcher after an actual open→close (never on
      // first mount, which would steal focus / scroll on page load).
      if (wasOpen.current) triggerRef.current?.focus();
      wasOpen.current = false;
      return undefined;
    }
    wasOpen.current = true;
    const focusables = () => Array.from(
      panelRef.current?.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])') || [],
    );
    focusables()[0]?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const pick = (key) => { setOpen(false); onSelect(key); };

  return (
    <div className="sm:hidden mb-6">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full flex items-center gap-3 min-h-[52px] px-3.5 py-2.5 rounded-2xl glass-card text-left transition hover:bg-white/[0.04]"
      >
        <span className="w-9 h-9 rounded-xl bg-brand-teal/15 text-brand-teal flex items-center justify-center flex-shrink-0">
          <Icon name={active?.icon} className="w-5 h-5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-medium uppercase tracking-wider text-gray-500">{CATEGORY_LABEL}</span>
          <span className="block text-white text-sm font-semibold truncate">{labelFor(active)}</span>
        </span>
        <span className="tab-count px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0">{counts[active?.key] || 0}</span>
        <Icon name="chevron-down" className="w-4 h-4 text-gray-400 flex-shrink-0" />
      </button>

      {open && (
        /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions --
           Backdrop-click-to-dismiss; mirrors `dashboard/MobileNav.jsx`. Escape is bound on the
           document while the sheet is open, which is the keyboard equivalent the rule wants. */
        <div
          data-no-ptr
          className="fixed inset-0 z-[1500] flex items-end justify-center bg-black/75 backdrop-blur-md"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
        >
          <div
            ref={panelRef}
            className="dz-modal-panel border border-white/10 w-full rounded-t-2xl p-4 pb-6 max-h-[85vh] flex flex-col shadow-2xl"
          >
            <div className="mx-auto w-9 h-1 rounded-full bg-white/15 mb-4" aria-hidden="true" />
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 id={headingId} className="text-white text-sm font-semibold">{CATEGORY_LABEL}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={tr('compare.close')}
                className="text-gray-400 hover:text-white flex-shrink-0"
              >
                <Icon name="x" className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              <div className="flex flex-col gap-2.5">
                {categories.map((c) => {
                  const isActive = c.key === activeKey;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => pick(c.key)}
                      aria-current={isActive ? 'true' : undefined}
                      className={'flex items-center gap-3 rounded-xl p-3 min-h-[64px] text-left transition ' + (isActive ? 'bg-brand-teal/15 ring-1 ring-inset ring-brand-teal/40' : 'bg-white/[0.03] hover:bg-white/[0.06]')}
                    >
                      <span className={'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ' + (isActive ? 'bg-brand-teal/20 text-brand-teal' : 'bg-white/5 text-gray-300')}>
                        <Icon name={c.icon} className="w-5 h-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={'block text-sm font-medium leading-tight ' + (isActive ? 'text-brand-teal' : 'text-white')}>{labelFor(c)}</span>
                        <span className="block text-xs text-gray-500 truncate">{descFor(c)}</span>
                      </span>
                      <span className="tab-count px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0">{counts[c.key] || 0}</span>
                      {isActive && <Icon name="check" className="w-4 h-4 text-brand-teal flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
