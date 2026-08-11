import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/Icon.jsx';

/* MobileNav — the dashboard's section switcher for phones (< lg).
   Replaces the old horizontal-scrolling pill strip, which only fit ~2.5 of the
   9–11 sections on screen and hid the rest (and their attention badges) behind a
   horizontal scroll. Here a single row shows the current section; tapping opens a
   bottom sheet listing EVERY section with its attention badge, so nothing is
   hidden and pending work is glanceable in one place.

   Reuses the dashboard's existing bottom-sheet look (pn-modal-panel, glass-card,
   brand-teal) — no new design language. Desktop keeps its sidebar unchanged. */
export default function MobileNav({ tabs, activeTab, onSelect, attentionCounts = {}, user, onLogout, labelFor }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const wasOpen = useRef(false);
  const active = useMemo(() => tabs.find((t) => t.tab === activeTab) || tabs[0], [tabs, activeTab]);

  // Sum of pending items across sections other than the current one — the badge
  // on the collapsed switcher tells the user "there's work waiting elsewhere".
  const otherAttention = useMemo(
    () => tabs.reduce((sum, t) => (t.tab === activeTab ? sum : sum + (attentionCounts[t.tab] || 0)), 0),
    [tabs, activeTab, attentionCounts],
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

  const pick = (tabId) => { setOpen(false); onSelect(tabId); };

  return (
    <div className="lg:hidden mb-5">
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
          <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-500">Dashboard section</span>
          <span className="block text-white text-sm font-semibold truncate">{labelFor(active)}</span>
        </span>
        {otherAttention > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-300">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> {otherAttention}
          </span>
        )}
        <Icon name="chevron-down" className="w-4 h-4 text-gray-400 flex-shrink-0" />
      </button>

      {open && (
        /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions --
           Backdrop-click-to-dismiss. The keyboard equivalent the rule asks for is Escape, and it is
           already bound on the document while the sheet is open (see the effect above); a keyboard
           listener on the backdrop itself would need the backdrop focused, which is exactly what the
           focus trap prevents. The close button inside the panel is the focusable way out. */
        <div
          className="fixed inset-0 z-[1500] flex items-end justify-center bg-black/75 backdrop-blur-md"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="Choose dashboard section"
        >
          <div
            ref={panelRef}
            className="pn-modal-panel border border-white/10 w-full rounded-t-2xl p-4 pb-6 max-h-[85vh] flex flex-col shadow-2xl"
          >
            <div className="mx-auto w-9 h-1 rounded-full bg-white/15 mb-4" aria-hidden="true" />
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {(user?.name || 'U').trim().charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-white text-sm font-semibold truncate">{user?.name || 'Your account'}</p>
                  <p className="text-gray-500 text-xs">Jump to a section</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-gray-400 hover:text-white flex-shrink-0"
              >
                <Icon name="x" className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              <div className="grid grid-cols-2 gap-2.5">
                {tabs.map((t) => {
                  const isActive = t.tab === activeTab;
                  const count = attentionCounts[t.tab] || 0;
                  return (
                    <button
                      key={t.tab}
                      type="button"
                      onClick={() => pick(t.tab)}
                      aria-current={isActive ? 'true' : undefined}
                      className={'relative flex flex-col items-start gap-2.5 rounded-xl p-3 min-h-[76px] transition ' + (isActive ? 'bg-brand-teal/15 ring-1 ring-inset ring-brand-teal/40 text-brand-teal' : 'bg-white/[0.03] text-gray-300 hover:bg-white/[0.06]')}
                    >
                      <span className={'w-9 h-9 rounded-lg flex items-center justify-center ' + (isActive ? 'bg-brand-teal/20 text-brand-teal' : 'bg-white/5 text-gray-300')}>
                        <Icon name={t.icon} className="w-5 h-5" />
                      </span>
                      <span className={'text-sm font-medium leading-tight ' + (isActive ? 'text-brand-teal' : 'text-white')}>{labelFor(t)}</span>
                      {count > 0 && (
                        <span className="absolute top-2.5 right-2.5 inline-flex min-w-[20px] items-center justify-center rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[11px] font-bold text-rose-300">{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => { setOpen(false); onLogout(); }}
              className="mt-3 w-full flex items-center justify-center gap-2 min-h-[44px] rounded-xl text-sm font-semibold text-rose-400 bg-rose-500/10 hover:bg-rose-500/15 transition"
            >
              <Icon name="log-out" className="w-4 h-4" /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
