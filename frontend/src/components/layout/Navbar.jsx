import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import LogoMark from '../brand/LogoMark.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useCity } from '../../context/CityContext.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import { useCompare } from '../../context/CompareContext.jsx';
import { useConversationUnread } from '../../context/ConversationContext.jsx';
import { useSaved } from '../../context/SavedContext.jsx';
import { usePlan } from '../../context/PlanContext.jsx';
import { TOPBAR_SCROLL } from '../../lib/chrome.js';
import { firstName, initial, roleLabel } from '../../lib/auth.js';
import useScrollLock from '../../hooks/useScrollLock.js';
import NotificationBell from '../notifications/NotificationBell.jsx';
/* Below lg the account menu is a full-height drawer; at lg+ the same state renders an anchored dropdown. */

const ACCT_DRAWER = '(max-width: 1023px)';

export default function Navbar() {
  const { t } = useTranslation();
  const { user, isIn, logout } = useAuth();
  const { city, setCity, openRequest, cities } = useCity();
  const { flagEnabled } = useAppFlags();
  const { count: compareCount } = useCompare();
  const saved = useSaved();
  const { listingLimit, isPaidOwner } = usePlan();
  const { unread: chatUnread } = useConversationUnread();
  const location = useLocation();
  const navigate = useNavigate();
  const [cityOpen, setCityOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  /* Help is the one area whose URL carries the language, and HelpLangRoute treats that prefix as authoritative — it
     calls changeLanguage() and i18n persists it device-wide. */
  const postLabel = !isPaidOwner && listingLimit === 1
    ? t('chrome.postPropertyFree')
    : t('nav.postProperty');
  // Bump on any local-prefs write so the badges below refresh live in the same tab, without
  // waiting for a route change.
  const [, setStoreTick] = useState(0);
  useEffect(() => {
    const bump = () => setStoreTick((n) => n + 1);
    window.addEventListener('pn:store', bump);
    return () => window.removeEventListener('pn:store', bump);
  }, []);
  const navRef = useRef(null);
  const cityRef = useRef(null);
  const acctRef = useRef(null);
  const acctDrawerRef = useRef(null);
  // `count` is the server's total, not the length of a page, so the badge stays right for a
  // shortlist longer than one page. The context is already empty when signed out.
  const savedCount = isIn ? saved.count : 0;
  const chatBadge = isIn ? chatUnread : 0;
  // Active-link detection mirroring components.js navHtml().

  const path = location.pathname.toLowerCase();
  const dealParam = new URLSearchParams(location.search).get('deal');
  const typeParam = (new URLSearchParams(location.search).get('type') || '').toLowerCase();
  const isHome = path === '/';
  // Compare Properties is only relevant while browsing buy/rent listings or a
  // property detail page (mirrors components.js compare:true on listings.html & property.html).
  const showCompare = path.startsWith('/listings') || path.startsWith('/property');
  // Flatmates is a rent-only feature: surface it only on the Flatmates page
  // itself or while viewing rent listings (mirrors components.js showFlatmates).
  const showFlatmates = path.startsWith('/flatmates') || (path.startsWith('/listings') && (dealParam === 'rent' || typeParam === 'flatmates'));
  const activeKey = path.startsWith('/reels') ? 'reels'
    : path === '/services' ? 'services'
    : path.startsWith('/flatmates') ? 'share'
    : path.startsWith('/listings') ? (dealParam === 'rent' ? 'rent' : 'buy')
    : '';
  const linkCls = (key) =>
    'relative px-3 py-2 text-[15px] font-medium transition-colors duration-200 ' +
    (activeKey === key
      ? 'text-white after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:w-1.5 after:h-1.5 after:rounded-full after:bg-teal-400'
      : 'text-gray-400 hover:text-white');
  // Mobile-only left-slot control off home: the city is fixed (Pune-only) there, so the pill gives
  // way to a compact icon-only Back affordance that keeps the bar from overflowing.

  const goBack = () => {
    if (location.key && location.key !== 'default') navigate(-1);
    else navigate('/');
  };
  const mobileContext = isHome ? null : (
    <button
      type="button"
      onClick={goBack}
      aria-label="Go back"
      title="Go back"
      className="dz-topbar__icon-box tap-extend relative lg:hidden grid place-items-center h-9 w-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300"
    >
      <Icon name="chevron-left" className="w-4 h-4 text-teal-500" />
    </button>
  );
  // Shared account-menu building blocks, reused by the desktop dropdown (lg+) and
  // the mobile drawer (below lg) so both surfaces stay in sync.

  const rowCls = 'flex items-center gap-3 min-h-[44px] px-3 py-2.5 rounded-xl text-sm text-gray-200 hover:bg-white/5 transition-all';
  const acctIdentity = (
    <div className="flex items-center gap-3 px-1 min-w-0">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-teal-500 to-teal-400 text-sm font-bold text-white shrink-0">{initial(user)}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white truncate">{user?.name || 'Draazy User'}</span>
        <span className="block text-xs text-gray-400">{roleLabel(user?.role)}</span>
      </span>
    </div>
  );
  const acctItems = (close, { mobile = false } = {}) => (
      /* Compare is the exception, and only on the drawer's side of the breakpoint. */
    <>
      {mobile ? (
        <Link to="/compare" onClick={close} className={rowCls}>
          <Icon name="git-compare" className="w-4 h-4 text-gray-400" />
          <span className="flex-1">Compare properties</span>
          {compareCount > 0 ? (
            <span className="min-w-5 h-5 px-1 grid place-items-center rounded-full bg-gradient-to-br from-teal-500 to-teal-400 text-[10px] font-bold text-white">{compareCount}</span>
          ) : null}
        </Link>
      ) : null}
      {['admin', 'manager', 'staff'].includes(user?.role) ? <Link to={user.role === 'staff' ? '/staff' : '/admin'} onClick={close} className={rowCls}><Icon name="shield-check" className="w-4 h-4 text-gray-400" /> {user.role === 'staff' ? 'Staff Panel' : 'Admin Panel'}</Link> : null}
      <Link to="/dashboard" onClick={close} className={rowCls}><Icon name="layout-grid" className="w-4 h-4 text-gray-400" /> Dashboard</Link>
      <Link to="/dashboard#profile" onClick={close} className={rowCls}><Icon name="user-cog" className="w-4 h-4 text-gray-400" /> Profile &amp; Settings</Link>
      <Link to="/dashboard#billing" onClick={close} className={rowCls}><Icon name="receipt-indian-rupee" className="w-4 h-4 text-gray-400" /> Plan &amp; Billing</Link>
      <Link to="/help" onClick={close} className={rowCls}><Icon name="book-open" className="w-4 h-4 text-gray-400" /> Help centre</Link>
      <Link to="/support" onClick={close} className={rowCls}><Icon name="life-buoy" className="w-4 h-4 text-gray-400" /> Contact support</Link>
      <Link to="/plans" onClick={close} className={rowCls}><Icon name="tag" className="w-4 h-4 text-gray-400" /> Pricing &amp; Plans</Link>
    </>
  /* `card` draws the row as a filled tile, used atop the mobile drawer where Refer is the one revenue-driving action
     and has to win against five same-weight rows below it. */
  );
  const acctRefer = (close, { card = false } = {}) => (
    <Link
      to="/refer"
      onClick={close}
      className={'flex items-center justify-between gap-3 px-3 rounded-xl text-sm font-semibold text-teal-200 transition-all '
        + (card
          ? 'min-h-[44px] py-2.5 bg-teal-400/10 border border-teal-400/30 hover:bg-teal-400/15'
          : 'py-2.5 hover:bg-teal-400/10')}
    >
      <span className="flex items-center gap-3"><Icon name="gift" className="w-4 h-4 text-teal-300 shrink-0" /> {t('nav.refer')}</span>
      <span className="text-[10px] font-bold uppercase tracking-wider text-teal-200 px-2 py-0.5 rounded-full bg-teal-400/15 shrink-0">{t('misc1.referForYou')}</span>
    </Link>
  );
  const acctLogout = (close) => (
    <button onClick={() => { close(); logout(); }} className="flex w-full items-center gap-3 min-h-[44px] text-left px-3 py-2.5 rounded-xl text-sm text-rose-300 hover:bg-white/5"><Icon name="log-out" className="w-4 h-4" /> Log out</button>
  );

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const root = document.documentElement;
    let ticking = false;
    let lastY = 0;
    // Thresholds live in lib/chrome.js so the top bar's behaviour is configured
    // alongside the bottom bar's, rather than as loose constants in this effect.
    const { hideAfter: HIDE_AFTER, delta: DELTA } = TOPBAR_SCROLL;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        nav.style.background = `rgb(var(--dz-c-ink) / ${Math.min(0.95, 0.6 + y / 400)})`;
        nav.style.boxShadow = y > 50 ? '0 4px 30px rgb(var(--dz-c-black) / 0.3)' : 'none';
        nav.style.borderBottomColor = y > 50 ? 'rgb(var(--dz-c-white) / 0.08)' : 'rgb(var(--dz-c-white) / 0.06)';

        const moved = y - lastY;
        if (Math.abs(moved) > DELTA) {
          // Toggled at every width; only the mobile stylesheet reacts to the class.
          root.classList.toggle('dz-nav-hidden', moved > 0 && y > HIDE_AFTER);
          lastY = y;
        } else if (y <= HIDE_AFTER) {
          root.classList.remove('dz-nav-hidden');
        }
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      root.classList.remove('dz-nav-hidden');
    };
  }, []);

  useEffect(() => {
    const onDoc = (e) => {
      if (cityRef.current && !cityRef.current.contains(e.target)) setCityOpen(false);
      // Ignore clicks inside the desktop dropdown (acctRef) or the mobile account
      // drawer (acctDrawerRef, rendered outside the nav), so neither self-closes.
      const inAcct = acctRef.current && acctRef.current.contains(e.target);
      const inAcctDrawer = acctDrawerRef.current && acctDrawerRef.current.contains(e.target);
      if (!inAcct && !inAcctDrawer) setAcctOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);
  /* Subscribed rather than sampled: the same `acctOpen` renders a drawer below lg and an anchored dropdown at lg+,
     and only the drawer should lock the page. */

  const [acctIsDrawer, setAcctIsDrawer] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(ACCT_DRAWER).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(ACCT_DRAWER);
    const onChange = (e) => setAcctIsDrawer(e.matches);
    mq.addEventListener('change', onChange);
    setAcctIsDrawer(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  useScrollLock(acctOpen && acctIsDrawer);
  // Escape closes the account menu, drawer or dropdown.

  useEffect(() => {
    if (!acctOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setAcctOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [acctOpen]);
  // Close the account menu whenever the route changes (a link was followed).

  useEffect(() => { setAcctOpen(false); }, [location.pathname, location.search]);

  return (
    /* Skip-to-content link (WCAG 2.4.1) */
    <>
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-teal-500 focus:text-white focus:text-sm focus:font-semibold">
      Skip to content
    </a>
    <nav
      ref={navRef}
      className="dz-topbar dz-safe-x fixed top-0 left-0 right-0 z-50 transition-all duration-500"
      style={{ background: 'rgb(var(--dz-c-ink) / 0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgb(var(--dz-c-white) / calc(0.06 * var(--dz-line-boost)))' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="dz-topbar__row flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link to="/" className="tap-target sm:min-h-0 sm:min-w-0 flex items-center gap-2 group">
              <LogoMark className="dz-topbar__icon-box w-9 h-9 shrink-0 text-teal-400 transition-transform duration-300 group-hover:scale-110" />
              <span className="hidden sm:inline text-xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">Draazy</span>
            </Link>

            <div className={`relative${isHome ? '' : ' hidden lg:block'}`} ref={cityRef}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setCityOpen((v) => !v); }}
                onKeyDown={(e) => { if (e.key === 'Escape') setCityOpen(false); if (e.key === 'ArrowDown' && !cityOpen) setCityOpen(true); }}
                aria-expanded={cityOpen}
                aria-haspopup="listbox"
                aria-label={`City: ${city}`}
                className="dz-topbar__pill tap-extend relative flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 min-w-0"
              >
                <Icon name="map-pin" className="w-4 h-4 text-teal-500 shrink-0" />
                <span className="text-sm font-semibold text-gray-200 truncate">{city}</span>
                <Icon name="chevron-down" className="w-3.5 h-3.5 text-gray-400 transition-transform duration-300 shrink-0" style={{ transform: cityOpen ? 'rotate(180deg)' : '' }} />
              </button>
              {cityOpen ? (
                <div role="listbox" aria-label="Select city" className="absolute left-0 mt-2 w-56 rounded-2xl bg-ink-card border border-white/10 shadow-2xl shadow-black/50 p-1.5 z-[60]">
                  {cities.filter((c) => c.live).map((c) => (
                    <button
                      key={c.name}
                      className={'w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm transition-all ' + (city === c.name ? 'text-white bg-white/5 border border-teal-400/30' : 'text-gray-300 hover:bg-white/5')}
                      onClick={() => { setCity(c.name); setCityOpen(false); }}
                    >
                      <span className="flex items-center gap-2.5"><Icon name="map-pin" className="w-4 h-4 text-teal-500" /> {c.name}</span>
                      {city === c.name ? <Icon name="check" className="w-4 h-4 text-teal-500" /> : null}
                    </button>
                  ))}
                  {cities.some((c) => !c.live) ? (
                    <p className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Coming soon</p>
                  ) : null}
                  {cities.filter((c) => !c.live).map((c) => (
                    <button
                      key={c.name}
                      className={'w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm transition-all ' + (city === c.name ? 'text-white bg-white/5 border border-teal-400/30' : 'text-gray-300 hover:bg-white/5')}
                      onClick={() => { setCity(c.name); setCityOpen(false); }}
                    >
                      <span className="flex items-center gap-2.5"><Icon name="building-2" className="w-4 h-4 text-gray-400" /> {c.name}</span>
                      {city === c.name ? <Icon name="check" className="w-4 h-4 text-teal-500" /> : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300">Soon</span>}
                    </button>
                  ))}
                  <div className="border-t border-white/10 mt-1.5 pt-1.5">
                    <button type="button" className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-teal-500 hover:bg-white/5 transition-all" onClick={() => { openRequest(); setCityOpen(false); }}>
                      <Icon name="bell-plus" className="w-4 h-4" /> Request your city
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            {mobileContext}
          </div>
          {/* Primary journeys live in the full desktop nav below, and inside the hamburger menu on mobile — no inline
             mobile strip, to keep the bar uncluttered when space is tight. */}

          <div className="hidden lg:flex items-center gap-1">
            <Link to="/listings?deal=buy" className={linkCls('buy')}>{t('nav.buy')}</Link>
            <Link to="/listings?deal=rent" className={linkCls('rent')}>{t('nav.rent')}</Link>
            {showFlatmates ? <Link to="/flatmates" className={linkCls('share')}>{t('nav.flatmates')}</Link> : null}
            {!isHome ? <Link to="/reels" className={linkCls('reels')}>{t('nav.reels')}</Link> : null}
            <Link to="/services" className={linkCls('services')}>{t('nav.services')}</Link>
          </div>

            {/* Desktop-only. Below lg the bottom tab bar owns Post — it has the raised centre slot in the thumb arc,
               which is a better home for the primary supply-side CTA than the top-right corner. */}
          <div className="flex items-center gap-3 shrink-0">
            <Link to="/list-property" className="hidden lg:inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-teal-600 to-teal-500 text-sm font-semibold text-white hover:shadow-lg hover:shadow-teal-500/25 transition-all duration-300 hover:scale-105">
              <Icon name="plus-circle" className="w-4 h-4" />
              {postLabel}
            </Link>
            {/* Signed in, this target leaves the phone bar for the drawer; signed out has no drawer. */}
            {showCompare || compareCount > 0 ? (
              <Link to="/compare" className={'dz-topbar__action tap-target tap-extend relative items-center justify-center p-2 rounded-xl hover:bg-white/5 transition-all duration-300 group ' + (isIn ? 'hidden lg:inline-flex' : 'inline-flex')} title="Compare Properties" aria-label="Compare properties">
                <Icon name="git-compare" className="w-5 h-5 text-gray-300 group-hover:text-white transition-colors" />
                {compareCount > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 bg-gradient-to-br from-teal-500 to-teal-400 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-lg shadow-teal-500/30">{compareCount}</span>}
              </Link>
            ) : null}
            {isIn ? (
              <>
                <Link to="/saved" className="dz-topbar__action tap-target tap-extend relative inline-flex items-center justify-center p-2 rounded-xl hover:bg-white/5 transition-all duration-300 group" title="Saved" aria-label="Saved properties">
                  <Icon name="heart" className="w-5 h-5 text-gray-300 group-hover:text-white transition-colors" />
                  {savedCount > 0 && <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-gradient-to-br from-orange-500 to-orange-400 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-lg shadow-orange-500/30">{savedCount}</span>}
                </Link>
                <NotificationBell />
                {flagEnabled('inAppMessaging') && (
                  <Link to="/messages" className="dz-topbar__action tap-target tap-extend relative inline-flex items-center justify-center p-2 rounded-xl hover:bg-white/5 transition-all duration-300 group" title="Messages" aria-label="Messages">
                    <Icon name="message-square" className="w-5 h-5 text-gray-300 group-hover:text-white transition-colors" />
                    {chatBadge > 0
                      ? <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 bg-gradient-to-br from-teal-500 to-teal-400 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-lg shadow-teal-500/30">{chatBadge}</span>
                      : <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-teal-500 shadow-md shadow-teal-500/40" />}
                  </Link>
                )}
                <div className="relative -mr-4 sm:mr-0" ref={acctRef}>
                  <button onClick={(e) => { e.stopPropagation(); setAcctOpen((v) => !v); }} aria-label="Account menu" aria-haspopup="menu" aria-expanded={acctOpen} className="dz-topbar__pill tap-extend relative flex items-center gap-1.5 sm:gap-2 pl-1 pr-2 sm:pr-2.5 py-1 rounded-l-full rounded-r-none sm:rounded-full bg-white/5 border border-r-0 sm:border-r border-teal-400/30 hover:border-teal-400/50 transition-all">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-teal-500 to-teal-400 text-xs font-bold text-white">{initial(user)}</span>
                    <span className="hidden sm:inline text-sm font-semibold text-gray-100">{firstName(user)}</span>
                    <Icon name="chevron-down" className="w-3.5 h-3.5 text-gray-400" style={{ transform: acctOpen ? 'rotate(180deg)' : '' }} />
                  {/* Desktop (lg+): anchored dropdown. */}
                  </button>
                  {acctOpen ? (
                    <div className="hidden lg:block absolute right-0 mt-2 w-64 rounded-2xl bg-ink-card border border-white/10 shadow-2xl shadow-black/50 p-2 z-[60] max-h-[80vh] overflow-y-auto">
                      <div className="py-1">{acctIdentity}</div>
                      <div className="border-t border-white/10 my-1.5" />
                      {acctItems(() => setAcctOpen(false))}
                      <div className="border-t border-white/10 my-1.5" />
                      {acctRefer(() => setAcctOpen(false))}
                      {acctLogout(() => setAcctOpen(false))}
                    </div>
                  ) : null}
                </div>
              </>
              /* Visible at every width: this is the only sign-in affordance, so it cannot be hidden behind a breakpoint. */
            ) : (
              <Link to="/signin" className="dz-topbar__pill tap-extend relative inline-flex items-center gap-1.5 sm:gap-2 px-4 sm:px-5 py-2 sm:py-2.5 rounded-full bg-gradient-to-r from-teal-500 to-teal-400 text-sm font-semibold text-white hover:shadow-lg hover:shadow-teal-500/25 transition-all duration-300 hover:scale-105">
                <Icon name="log-in" className="w-4 h-4" /> Sign In
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
    {/* Mobile account menu — a right-anchored slide-in drawer with a dimmed backdrop. */}

    {isIn ? (
      <div
        ref={acctDrawerRef}
        className={'lg:hidden fixed inset-0 z-[80] transition-opacity duration-300 ' + (acctOpen ? 'opacity-100' : 'opacity-0 pointer-events-none')}
        /* The header and footer mount unconditionally so the panel keeps its shape through the slide-out, which left
           real buttons focusable inside an `aria-hidden` subtree. */
        aria-hidden={!acctOpen}
        inert={!acctOpen}
      >
        <button type="button" aria-label="Close account menu" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAcctOpen(false)} />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Account"
          className={'absolute top-0 right-0 h-full w-[300px] max-w-[85vw] bg-ink-card border-l border-white/10 shadow-2xl shadow-black/50 flex flex-col transition-transform duration-300 ease-out ' + (acctOpen ? 'translate-x-0' : 'translate-x-full')}
        >
          <div className="flex items-center justify-between gap-2 px-4 h-16 border-b border-white/5 shrink-0">
            {acctIdentity}
            <button onClick={() => setAcctOpen(false)} aria-label="Close menu" className="tap-target p-2 -mr-2 rounded-xl hover:bg-white/5 transition-all shrink-0">
              <Icon name="x" className="w-5 h-5 text-gray-300" />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Account">
            {acctOpen ? (
              <>
                {acctRefer(() => setAcctOpen(false), { card: true })}
                <div className="border-t border-white/10 my-2" />
                {acctItems(() => setAcctOpen(false), { mobile: true })}
              </>
            ) : null}
          </nav>
          <div className="p-3 border-t border-white/5 shrink-0 space-y-1">
            {acctLogout(() => setAcctOpen(false))}
          </div>
        </aside>
      </div>
    ) : null}
    </>
  );
}
