import { Link, useLocation } from 'react-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { usePostChooser, usePostChooserOpen } from '../../context/PostChooserContext.jsx';

/* Mobile bottom tab bar (below lg), the primary wayfinding surface on phones. Slot choices,
   the floating-capsule material and the inset it reserves: docs/system/design-system.md. */

function Tab({ to, icon, label, active, onClick, slotRef, ...rest }) {
  return (
    <Link
      to={to}
      ref={slotRef}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      {...rest}
      /* Explicit name so the visible label can be dropped in landscape, where
         vertical space is scarce, without leaving the tab unnamed. */
      aria-label={label}
      /* gray-300, not gray-400: the bar is translucent, so a bright gallery or reel can sit
         directly behind these labels. */
      className={
        'dz-bottom-nav__tab relative flex flex-1 flex-col items-center justify-center gap-0.5 min-w-[52px] transition-colors ' +
        (active ? 'text-teal-100' : 'text-gray-300')
      }
    >
      <Icon name={icon} className="w-[22px] h-[22px]" weight={active ? 'fill' : 'regular'} />
      <span className={'dz-bottom-nav__label ' + (active ? 'font-semibold' : 'font-medium')}>{label}</span>
    </Link>
  );
}

export default function BottomNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { openPostChooser } = usePostChooser();
  const postChooserOpen = usePostChooserOpen();

  const path = pathname.toLowerCase();

  /* One indicator that travels, because the tabs are siblings in a single control. Post is
     excluded even when current: a capsule sliding under its raised circle looks like a collision. */
  const SLOTS = useMemo(() => ['/reels', '/listings', null, '/flatmates', '/services'], []);
  const activeIndex = SLOTS.findIndex((p) => p && path.startsWith(p));

  const navRef = useRef(null);
  const tabRefs = useRef([]);
  // Stable per-slot ref callbacks; inline arrow refs detach and re-attach every render,
  // which is noise the measurement below would have to tolerate for no gain.
  const setSlotRef = useMemo(
    () => SLOTS.map((_, i) => (el) => { tabRefs.current[i] = el; }),
    [SLOTS],
  );

  /* Starts null so a route owning no slot still leaves a real element to fade, rather than
     unmounting it and making the next tab pop in with no travel. */
  const [rect, setRect] = useState(null);

  /* Transition off for the first paint: measuring forces a style resolution at the unmeasured
     x=0/width=0 default, so a live transition slides the capsule in on every page load. */
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (rect) setAnimate(true);
  }, [rect]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const el = tabRefs.current[activeIndex];
    // No active slot (Home, Post, or any non-tab route): keep the last geometry and
    // just fade the indicator out, so returning to a tab slides from where it left.
    if (!nav || !el) return undefined;

    const measure = () => {
      const n = nav.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setRect({ left: r.left - n.left, width: r.width });
    };
    measure();

    // Slot widths are flex-derived, so rotation, dynamic type and the landscape rules all move
    // them; observing the bar keeps the indicator attached without a resize listener.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [activeIndex]);

  /* Search is a plain link to /listings from everywhere, Home included — /listings already IS the
     search surface, and a tab that opens a modal on one route makes the bar unpredictable. */

  return (
    <nav
      ref={navRef}
      aria-label={t('nav.primaryMobile', 'Primary')}
      className="dz-bottom-nav lg:hidden"
    >
      {/* Active state carries a filled capsule, not just a colour shift — WCAG 1.4.1. Rendered
          first so it paints behind the tabs without either side needing a z-index. */}
      <span
        aria-hidden="true"
        className={'dz-bottom-nav__indicator' + (animate ? ' is-animated' : '')}
        style={{
          transform: `translateX(${rect ? rect.left : 0}px)`,
          width: rect ? `${rect.width}px` : 0,
          opacity: rect && activeIndex >= 0 ? 1 : 0,
        }}
      />

      <Tab slotRef={setSlotRef[0]} to="/reels" icon="video" label={t('nav.reels', 'Reels')} active={activeIndex === 0} />
      <Tab
        slotRef={setSlotRef[1]}
        to="/listings"
        icon="search"
        label={t('nav.search', 'Search')}
        active={activeIndex === 1}
      />

      {/* Raised centre slot — the ONLY posting control below 1024px (`.sf-post-cta` is the exact
          complement). Opens the sheet; the auth gate sits one step later, on the chosen branch. */}
      <button
        type="button"
        onClick={openPostChooser}
        aria-label={t('nav.postProperty')}
        aria-haspopup="dialog"
        /* This control stays on screen while what it opened is open, so it has to say so — or a
           screen-reader user who dismisses with Escape lands on a button still announcing a dialog. */
        aria-expanded={postChooserOpen}
        /* No visible label: at 200% text one stacked under the circle needs ~61px inside a 56px
           bar and deforms it, and `aria-label` already names the button. */
        className="dz-bottom-nav__tab flex flex-1 flex-col items-center justify-center min-w-[52px]"
      >
        <span className="dz-bottom-nav__fab grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-[#0d9488] to-[#14b8a6] text-white">
          <Icon name="plus" className="w-6 h-6 stroke-[2.5]" />
        </span>
      </button>

      {/* Both tabs avoid glyphs spoken for elsewhere: `users` is the occupants chip on property
          cards and `sparkles` is the AI-search mark, so a tab wearing it reads as "AI". */}
      <Tab slotRef={setSlotRef[3]} to="/flatmates" icon="users-round" label={t('nav.flatmates', 'Flatmates')} active={activeIndex === 3} />
      <Tab slotRef={setSlotRef[4]} to="/services" icon="toolbox" label={t('nav.services', 'Services')} active={activeIndex === 4} />
    </nav>
  );
}
