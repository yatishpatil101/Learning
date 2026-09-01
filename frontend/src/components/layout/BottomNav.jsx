import { Link, useLocation } from 'react-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/* Mobile bottom tab bar (below lg). Draazy's primary wayfinding surface on phones:
   the top navbar + hamburger sit in the hardest-to-reach corner, so every navigation
   act used to need a top-right stretch.

   Slots are the five things a phone user actually does here — Reels · Search · Post ·
   Flatmates · Services — with Post raised in the centre of the thumb arc because the
   marketplace is supply-first. Home is not a slot: the wordmark already goes home from
   the top bar, so a Home tab was spending a scarce slot on a destination nobody
   navigates *to* mid-session. Icons reuse the ones the desktop hamburger already maps
   to these routes (video / users / sparkles) so the two menus never disagree.

   Presentation is a floating capsule rather than an edge-to-edge bar — see
   .dz-bottom-nav in index.css. Hidden at lg and up; the desktop navbar is untouched.
   Mounted by ConsumerLayout, which also sets .has-bottom-nav so --dz-bottom-inset
   reserves the bar's height *and* its floating gap for every other bottom-anchored
   widget. */

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
      /* gray-300, not gray-400: the bar is translucent, so a bright gallery or reel can
         end up directly behind these labels. The lighter grey is what keeps them
         readable in that worst case without making an inactive tab look active. */
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
  const { isIn } = useAuth();

  const path = pathname.toLowerCase();

  /* One indicator that travels, rather than five that cross-fade. The tabs are
     siblings in a single control, and a shape that slides between them says so;
     five independent fades say they are five unrelated buttons. It also gives the
     eye something to follow, so the user can see *which* way they moved.

     Post is deliberately not in this list even though it can be the current route:
     its raised circle already reads as selected, and a capsule sliding under a
     protruding button looks like a collision. */
  const SLOTS = useMemo(() => ['/reels', '/listings', null, '/flatmates', '/services'], []);
  const activeIndex = SLOTS.findIndex((p) => p && path.startsWith(p));

  const navRef = useRef(null);
  const tabRefs = useRef([]);
  // Stable per-slot ref callbacks. Inline arrow refs are a new function every render,
  // which makes React detach and re-attach on each pass — noise the measurement below
  // would have to tolerate for no gain.
  const setSlotRef = useMemo(
    () => SLOTS.map((_, i) => (el) => { tabRefs.current[i] = el; }),
    [SLOTS],
  );

  /* Geometry of the slot the indicator currently sits on. Starts null — the indicator
     is still rendered, just transparent and zero-width — so a route that owns no slot
     (Home, Post, /property/…) leaves a real element in the DOM to fade rather than
     unmounting it, which would make the next tab pop in with no travel. */
  const [rect, setRect] = useState(null);

  /* The transition is off for the first paint and switched on afterwards.

     Measuring calls getBoundingClientRect, which forces a style resolution while the
     indicator is still at its unmeasured x=0/width=0 default. With the transition
     already live, the correction that follows animates — so every fresh page load slid
     the capsule in from the left edge, and a test reading its position mid-flight found
     it 18px short of the tab. Deferring the class to a post-paint effect means the
     first painted frame is already correct and static; only later route changes
     animate, which is the only time the travel means anything. */
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

    // Slot widths are flex-derived, so they change on rotation, on dynamic-type
    // changes, and when the landscape rules shrink the bar. Observing the bar keeps
    // the indicator attached to its tab through all three without a resize listener.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [activeIndex]);

  /* Search is a plain link to /listings from everywhere, Home included. It briefly
     opened a full-screen search sheet on Home instead, on the theory that a phone
     needs a dedicated search surface — but /listings already *is* that surface: it
     carries the same Buy/Rent tabs and query box above a live result set, so the
     sheet was an extra tap and a second place to maintain the same controls. A tab
     that navigates on four routes and opens a modal on the fifth is also the kind of
     inconsistency that makes a tab bar feel unpredictable. */

  const postTo = isIn ? '/list-property' : '/signin?next=/list-property';

  return (
    <nav
      ref={navRef}
      aria-label={t('nav.primaryMobile', 'Primary')}
      className="dz-bottom-nav lg:hidden"
    >
      {/* Active state carries a filled capsule, not just a colour shift — WCAG 1.4.1.
          Rendered first so it paints behind the tabs without either side needing a
          z-index, and measured in a layout effect so the first painted frame already
          sits on the right slot — a deep-linked route never slides in from x=0. */}
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

      {/* Raised centre slot — the supply-first bet. Signed-out users go through
          sign-in with a next= hop rather than bouncing off the route guard. */}
      <Link
        to={postTo}
        aria-label={t('nav.postProperty')}
        aria-current={path.startsWith('/list-property') ? 'page' : undefined}
        /* No visible label under the circle. It used to carry one, baselined against
           the sibling tabs with `justify-end` and a 9px pad; at 200% text that stack
           needed ~61px inside a 56px bar and the circle deformed to fit (D98a). The
           label was pure redundancy — the plus glyph is the universal post affordance
           and the link is already named by `aria-label`, so nothing was said twice for
           a screen reader either. Centring the circle is what the free height buys. */
        className="dz-bottom-nav__tab flex flex-1 flex-col items-center justify-center min-w-[52px]"
      >
        <span className="dz-bottom-nav__fab grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-[#0d9488] to-[#14b8a6] text-white">
          <Icon name="plus" className="w-6 h-6 stroke-[2.5]" />
        </span>
      </Link>

      {/* Both tabs avoid glyphs that are spoken for elsewhere: `users` is the
          sharing/occupants chip on property cards, and `sparkles` is the AI-search
          mark (smart-search fields, assistant FAB) — a tab wearing it reads as "AI"
          rather than as a destination. */}
      <Tab slotRef={setSlotRef[3]} to="/flatmates" icon="users-round" label={t('nav.flatmates', 'Flatmates')} active={activeIndex === 3} />
      <Tab slotRef={setSlotRef[4]} to="/services" icon="toolbox" label={t('nav.services', 'Services')} active={activeIndex === 4} />
    </nav>
  );
}
