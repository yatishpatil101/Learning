import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useCity } from '../../context/CityContext.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import { useCompare } from '../../context/CompareContext.jsx';
import { getSavedProps, unreadNotifCount } from '../../lib/store.js';
import { useChatUnread } from '../../lib/chat.js';
import { firstName, initial, roleLabel } from '../../lib/auth.js';

export default function Navbar() {
  const { t } = useTranslation();
  const { user, isIn, logout } = useAuth();
  const { city, setCity, openRequest, cities } = useCity();
  const { flagEnabled } = useAppFlags();
  const { count: compareCount } = useCompare();
  const location = useLocation();
  const navigate = useNavigate();
  const [cityOpen, setCityOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  // Bump on any store write (saved / notifications) so the badges below refresh
  // live in the same tab, without waiting for a route change.
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
  const savedCount = isIn ? getSavedProps().length : 0;
  const unreadCount = isIn ? unreadNotifCount() : 0;
  const chatUnread = useChatUnread();
  const chatBadge = isIn ? chatUnread : 0;

  // Active-link detection mirroring components.js navHtml().
  const path = location.pathname.toLowerCase();
  const dealParam = new URLSearchParams(location.search).get('deal');
  const typeParam = (new URLSearchParams(location.search).get('type') || '').toLowerCase();
  const isHome = path === '/';
  // Compare Properties is only relevant while browsing buy/rent listings or a
  // property detail page (mirrors components.js compare:true on listings.html & property.html).
  const showCompare = path.startsWith('/listings') || path.startsWith('/property');
  // Share-a-Flat is a rent-only feature: surface it only on the Share-a-Flat page
  // itself or while viewing rent listings (mirrors components.js showShare).
  const showShare = path.startsWith('/share-flat') || (path.startsWith('/listings') && (dealParam === 'rent' || typeParam === 'pg' || typeParam === 'flatmates'));
  const activeKey = path.startsWith('/reels') ? 'reels'
    : path === '/services' ? 'services'
    : path.startsWith('/share-flat') ? 'share'
    : path.startsWith('/listings') ? (dealParam === 'rent' ? 'rent' : 'buy')
    : '';
  const linkCls = (key) =>
    'relative px-3 py-2 text-[15px] font-medium transition-colors duration-200 ' +
    (activeKey === key
      ? 'text-white after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:w-1.5 after:h-1.5 after:rounded-full after:bg-teal-400'
      : 'text-gray-400 hover:text-white');
  // Shared mobile menu toggle. Rendered just LEFT of the account pill (or as the
  // sole trailing control when logged out) so the avatar keeps the rightmost,
  // half-pill position it has always had.
  const menuBtn = (
    <button onClick={() => { setMobileOpen((v) => !v); setAcctOpen(false); }} aria-expanded={mobileOpen} aria-controls="mobile-nav" aria-label="Toggle menu" className="lg:hidden p-2 rounded-xl hover:bg-white/5 transition-all">
      <Icon name={mobileOpen ? 'x' : 'menu'} className="w-5 h-5 text-gray-300" />
    </button>
  );

  // Mobile-only control for the left slot on non-home pages. The city is fixed
  // (Pune-only) once you leave home, so instead of the city pill we show a single,
  // compact Back affordance. It's icon-only (no page-name label) to stay minimal
  // and to keep the bar from overflowing — which is what pushed the account pill
  // and hamburger off-screen on narrow phones.
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
      className="lg:hidden grid place-items-center h-9 w-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300"
    >
      <Icon name="chevron-left" className="w-4 h-4 text-[#14b8a6]" />
    </button>
  );

  // Shared account-menu building blocks, reused by the desktop dropdown (lg+) and
  // the mobile drawer (below lg) so both surfaces stay in sync.
  const rowCls = 'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-200 hover:bg-white/5 transition-all';
  const acctIdentity = (
    <div className="flex items-center gap-3 px-1 min-w-0">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-teal-500 to-teal-400 text-sm font-bold text-white shrink-0">{initial(user)}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white truncate">{user?.name || 'PuneNest User'}</span>
        <span className="block text-xs text-gray-400">{roleLabel(user?.role)}</span>
      </span>
    </div>
  );
  const acctItems = (close) => (
    <>
      {/* Quick actions surfaced only below sm, where the standalone heart / bell /
         message icons are hidden to make room for Post Property. */}
      <div className="sm:hidden">
        {flagEnabled('savedListings') && (
          <Link to="/saved" onClick={close} className={rowCls + ' justify-between'}>
            <span className="flex items-center gap-3"><Icon name="heart" className="w-4 h-4 text-gray-400" /> Saved</span>
            {savedCount > 0 && <span className="min-w-5 h-5 px-1.5 grid place-items-center bg-gradient-to-br from-[#f97316] to-[#fb923c] rounded-full text-[10px] font-bold text-white">{savedCount}</span>}
          </Link>
        )}
        <Link to="/notifications" onClick={close} className={rowCls + ' justify-between'}>
          <span className="flex items-center gap-3"><Icon name="bell" className="w-4 h-4 text-gray-400" /> Notifications</span>
          {unreadCount > 0 && <span className="min-w-5 h-5 px-1.5 grid place-items-center bg-gradient-to-br from-[#f97316] to-[#fb923c] rounded-full text-[10px] font-bold text-white">{unreadCount}</span>}
        </Link>
        {flagEnabled('inAppMessaging') && (
          <Link to="/messages" onClick={close} className={rowCls + ' justify-between'}>
            <span className="flex items-center gap-3"><Icon name="message-square" className="w-4 h-4 text-gray-400" /> Messages</span>
            {chatBadge > 0
              ? <span className="min-w-5 h-5 px-1.5 grid place-items-center bg-gradient-to-br from-teal-500 to-teal-400 rounded-full text-[10px] font-bold text-white">{chatBadge}</span>
              : <span className="w-2 h-2 rounded-full bg-teal-400" />}
          </Link>
        )}
        <div className="border-t border-white/10 my-1.5" />
      </div>
      {user?.role === 'admin' ? <Link to="/admin" onClick={close} className={rowCls}><Icon name="shield-check" className="w-4 h-4 text-gray-400" /> Admin Panel</Link> : null}
      {user?.role === 'staff' ? <Link to="/ops" onClick={close} className={rowCls}><Icon name="headset" className="w-4 h-4 text-gray-400" /> Ops Console</Link> : null}
      <Link to="/dashboard" onClick={close} className={rowCls}><Icon name="layout-grid" className="w-4 h-4 text-gray-400" /> Dashboard</Link>
      <Link to="/dashboard#profile" onClick={close} className={rowCls}><Icon name="user-cog" className="w-4 h-4 text-gray-400" /> Profile &amp; Settings</Link>
      <Link to="/dashboard#billing" onClick={close} className={rowCls}><Icon name="receipt-indian-rupee" className="w-4 h-4 text-gray-400" /> Plan &amp; Billing</Link>
      <Link to="/support" onClick={close} className={rowCls}><Icon name="life-buoy" className="w-4 h-4 text-gray-400" /> Help &amp; Support</Link>
      <Link to="/plans" onClick={close} className={rowCls}><Icon name="tag" className="w-4 h-4 text-gray-400" /> Pricing &amp; Plans</Link>
    </>
  );
  const acctRefer = (close) => (
    <Link to="/refer" onClick={close} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-teal-200 hover:bg-teal-400/10 transition-all">
      <span className="flex items-center gap-3"><Icon name="gift" className="w-4 h-4 text-teal-300" /> {t('nav.refer')}</span>
      <span className="text-[10px] font-bold uppercase tracking-wider text-teal-200 px-2 py-0.5 rounded-full bg-teal-400/15">{t('misc1.referForYou')}</span>
    </Link>
  );
  const acctLogout = (close) => (
    <button onClick={() => { close(); logout(); }} className="flex w-full items-center gap-3 text-left px-3 py-2.5 rounded-xl text-sm text-rose-300 hover:bg-white/5"><Icon name="log-out" className="w-4 h-4" /> Log out</button>
  );

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        nav.style.background = `rgba(15,13,26,${Math.min(0.95, 0.6 + y / 400)})`;
        nav.style.boxShadow = y > 50 ? '0 4px 30px rgba(0,0,0,0.3)' : 'none';
        nav.style.borderBottomColor = y > 50 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.06)';
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
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

  // While a mobile drawer (hamburger or account) is open, lock body scroll and
  // allow Escape to close, so both behave like proper modal surfaces. The
  // account menu is a drawer only below lg; at lg+ it's a dropdown that must not
  // lock scroll.
  useEffect(() => {
    if (!mobileOpen && !acctOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setMobileOpen(false); setAcctOpen(false); } };
    document.addEventListener('keydown', onKey);
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;
    const shouldLock = mobileOpen || (acctOpen && isMobile);
    const prev = document.body.style.overflow;
    if (shouldLock) document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      if (shouldLock) document.body.style.overflow = prev;
    };
  }, [mobileOpen, acctOpen]);

  // Close any open drawer/menu whenever the route changes (a link was followed).
  useEffect(() => { setMobileOpen(false); setAcctOpen(false); }, [location.pathname, location.search]);

  return (
    <>
    {/* Skip-to-content link (WCAG 2.4.1) */}
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-teal-500 focus:text-white focus:text-sm focus:font-semibold">
      Skip to content
    </a>
    <nav
      ref={navRef}
      className="fixed top-0 left-0 w-full z-50 transition-all duration-500"
      style={{ background: 'rgba(15,13,26,0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 md:h-[72px]">
          <div className="flex items-center gap-2 sm:gap-3">
            <Link to="/" className="flex items-center gap-2 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-teal-400 flex items-center justify-center transition-transform duration-300 group-hover:scale-110 shadow-sm shadow-teal-500/20">
                <Icon name="home" className="w-5 h-5 text-white" />
              </div>
              <span className="hidden sm:inline text-xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">PuneNest</span>
            </Link>

            <div className={`relative${isHome ? '' : ' hidden lg:block'}`} ref={cityRef}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setCityOpen((v) => !v); }}
                onKeyDown={(e) => { if (e.key === 'Escape') setCityOpen(false); if (e.key === 'ArrowDown' && !cityOpen) setCityOpen(true); }}
                aria-expanded={cityOpen}
                aria-haspopup="listbox"
                aria-label={`City: ${city}`}
                className="flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300"
              >
                <Icon name="map-pin" className="w-4 h-4 text-[#14b8a6]" />
                <span className="text-sm font-semibold text-gray-200">{city}</span>
                <Icon name="chevron-down" className="w-3.5 h-3.5 text-gray-400 transition-transform duration-300" style={{ transform: cityOpen ? 'rotate(180deg)' : '' }} />
              </button>
              {cityOpen ? (
                <div role="listbox" aria-label="Select city" className="absolute left-0 mt-2 w-56 rounded-2xl bg-[#15122a] border border-white/10 shadow-2xl shadow-black/50 p-1.5 z-[60]">
                  {cities.filter((c) => c.live).map((c) => (
                    <button
                      key={c.name}
                      className={'w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm transition-all ' + (city === c.name ? 'text-white bg-white/5 border border-teal-400/30' : 'text-gray-300 hover:bg-white/5')}
                      onClick={() => { setCity(c.name); setCityOpen(false); }}
                    >
                      <span className="flex items-center gap-2.5"><Icon name="map-pin" className="w-4 h-4 text-[#14b8a6]" /> {c.name}</span>
                      {city === c.name ? <Icon name="check" className="w-4 h-4 text-[#14b8a6]" /> : null}
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
                      {city === c.name ? <Icon name="check" className="w-4 h-4 text-[#14b8a6]" /> : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300">Soon</span>}
                    </button>
                  ))}
                  <div className="border-t border-white/10 mt-1.5 pt-1.5">
                    <button type="button" className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-[#14b8a6] hover:bg-white/5 transition-all" onClick={() => { openRequest(); setCityOpen(false); }}>
                      <Icon name="bell-plus" className="w-4 h-4" /> Request your city
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            {mobileContext}
          </div>

          {/* Primary journeys live in the full desktop nav below, and inside the
             hamburger menu on mobile — no inline mobile strip, to keep the bar
             uncluttered when space is tight. */}
          <div className="hidden lg:flex items-center gap-1">
            <Link to="/listings?deal=buy" className={linkCls('buy')}>{t('nav.buy')}</Link>
            <Link to="/listings?deal=rent" className={linkCls('rent')}>{t('nav.rent')}</Link>
            {showShare ? <Link to="/share-flat" className={linkCls('share')}>{t('nav.shareFlat')}</Link> : null}
            {!isHome ? <Link to="/reels" className={linkCls('reels')}>{t('nav.reels')}</Link> : null}
            <Link to="/services" className={linkCls('services')}>{t('nav.services')}</Link>
          </div>

          <div className="flex items-center gap-3">
            <Link to="/list-property" className="inline-flex items-center gap-1.5 sm:gap-2 px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-full bg-gradient-to-r from-[#0d9488] to-[#14b8a6] text-sm font-semibold text-white hover:shadow-lg hover:shadow-teal-500/25 transition-all duration-300 hover:scale-105">
              <Icon name="plus-circle" className="w-4 h-4" />
              <span className="sm:hidden">{t('nav.post')}</span>
              <span className="hidden sm:inline">{t('nav.postProperty')}</span>
            </Link>
            {flagEnabled('compareProperties') && (showCompare || compareCount > 0) ? (
              <Link to="/compare" className="relative p-2 rounded-xl hover:bg-white/5 transition-all duration-300 group" title="Compare Properties">
                <Icon name="git-compare" className="w-5 h-5 text-gray-300 group-hover:text-white transition-colors" />
                {compareCount > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 bg-gradient-to-br from-teal-500 to-teal-400 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-lg shadow-teal-500/30">{compareCount}</span>}
              </Link>
            ) : null}
            {isIn ? (
              <>
                {flagEnabled('savedListings') && (
                  <Link to="/saved" className="relative hidden sm:inline-flex p-2 rounded-xl hover:bg-white/5 transition-all duration-300 group">
                    <Icon name="heart" className="w-5 h-5 text-gray-300 group-hover:text-white transition-colors" />
                    {savedCount > 0 && <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-gradient-to-br from-[#f97316] to-[#fb923c] rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-lg shadow-orange-500/30">{savedCount}</span>}
                  </Link>
                )}
                <Link to="/notifications" className="relative hidden sm:inline-flex p-2 rounded-xl hover:bg-white/5 transition-all duration-300 group" title="Notifications">
                  <Icon name="bell" className="w-5 h-5 text-gray-300 group-hover:text-white transition-colors" />
                  {unreadCount > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 bg-gradient-to-br from-[#f97316] to-[#fb923c] rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-lg shadow-orange-500/30">{unreadCount}</span>}
                </Link>
                {flagEnabled('inAppMessaging') && (
                  <Link to="/messages" className="relative hidden sm:inline-flex p-2 rounded-xl hover:bg-white/5 transition-all duration-300 group" title="Messages">
                    <Icon name="message-square" className="w-5 h-5 text-gray-300 group-hover:text-white transition-colors" />
                    {chatBadge > 0
                      ? <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 bg-gradient-to-br from-teal-500 to-teal-400 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-lg shadow-teal-500/30">{chatBadge}</span>
                      : <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-teal-400 ring-2 ring-[#0f0d1a]" />}
                  </Link>
                )}
                {menuBtn}
                <div className="relative -mr-4 sm:mr-0" ref={acctRef}>
                  <button onClick={(e) => { e.stopPropagation(); setMobileOpen(false); setAcctOpen((v) => !v); }} aria-label="Account menu" aria-haspopup="menu" aria-expanded={acctOpen} className="flex items-center gap-2 pl-1 pr-3.5 sm:pr-2.5 py-1 rounded-l-full rounded-r-none sm:rounded-full bg-white/5 border border-r-0 sm:border-r border-teal-400/30 hover:border-teal-400/50 transition-all">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-teal-500 to-teal-400 text-xs font-bold text-white">{initial(user)}</span>
                    <span className="hidden sm:inline text-sm font-semibold text-gray-100">{firstName(user)}</span>
                    <Icon name="chevron-down" className="w-3.5 h-3.5 text-gray-400" style={{ transform: acctOpen ? 'rotate(180deg)' : '' }} />
                  </button>
                  {/* Desktop (lg+): anchored dropdown. On smaller screens the account
                     menu renders as a right drawer (see below) to match the hamburger. */}
                  {acctOpen ? (
                    <div className="hidden lg:block absolute right-0 mt-2 w-64 rounded-2xl bg-[#15122a] border border-white/10 shadow-2xl shadow-black/50 p-2 z-[60] max-h-[80vh] overflow-y-auto">
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
            ) : (
              <>
                <Link to="/signin" className="hidden sm:inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-teal-500 to-teal-400 text-sm font-semibold text-white hover:shadow-lg hover:shadow-teal-500/25 transition-all duration-300 hover:scale-105">
                  <Icon name="log-in" className="w-4 h-4" /> Sign In
                </Link>
                {menuBtn}
              </>
            )}
          </div>
        </div>
      </div>
    </nav>

    {/* Mobile navigation — right-anchored slide-in drawer with a dimmed backdrop.
       Standard mobile pattern: a compact panel (not the whole screen) that
       visually connects to the top-right hamburger. Body scroll locks and
       Escape/backdrop close it. */}
    <div
      className={'lg:hidden fixed inset-0 z-[80] transition-opacity duration-300 ' + (mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none')}
      aria-hidden={!mobileOpen}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
      <aside
        id="mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={'absolute top-0 right-0 h-full w-[300px] max-w-[85vw] bg-[#15122a] border-l border-white/10 shadow-2xl shadow-black/50 flex flex-col transition-transform duration-300 ease-out ' + (mobileOpen ? 'translate-x-0' : 'translate-x-full')}
      >
        <div className="flex items-center justify-between px-5 h-16 border-b border-white/5 shrink-0">
          <span className="text-base font-semibold text-white">Menu</span>
          <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="p-2 -mr-2 rounded-xl hover:bg-white/5 transition-all">
            <Icon name="x" className="w-5 h-5 text-gray-300" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Mobile">
          {[
            { to: '/listings?deal=buy', label: t('nav.buy'), icon: 'tag' },
            { to: '/listings?deal=rent', label: t('nav.rent'), icon: 'key' },
            { to: '/share-flat', label: t('nav.shareFlat'), icon: 'users' },
            { to: '/reels', label: t('nav.reels'), icon: 'video' },
            { to: '/services', label: t('nav.services'), icon: 'sparkles' },
            { to: '/refer', label: t('nav.refer'), icon: 'gift', highlight: true },
          ].map((it) => (
            <Link
              key={it.to}
              to={it.to}
              onClick={() => setMobileOpen(false)}
              className={'group flex items-center gap-3.5 px-3 py-3 rounded-xl text-[15px] transition-all ' + (it.highlight
                ? 'font-semibold text-white bg-gradient-to-r from-teal-500/15 via-teal-500/[.06] to-transparent hover:from-teal-500/25 hover:via-teal-500/10'
                : 'text-gray-200 hover:text-white hover:bg-white/5')}
            >
              <span className={'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ' + (it.highlight ? 'bg-gradient-to-br from-teal-400 to-orange-400 shadow-sm shadow-teal-500/25 group-hover:scale-105 transition-transform' : 'bg-white/5')}>
                <Icon name={it.icon} className={'w-[18px] h-[18px] ' + (it.highlight ? 'text-white' : 'text-[#14b8a6]')} />
              </span>
              {it.label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-white/5 shrink-0 space-y-2">
          <Link to="/list-property" onClick={() => setMobileOpen(false)} className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-[#0d9488] to-[#14b8a6] hover:shadow-lg hover:shadow-teal-500/25 transition-all">
            <Icon name="plus-circle" className="w-4 h-4" /> Post Property
          </Link>
          {!isIn ? (
            <Link to="/signin" onClick={() => setMobileOpen(false)} className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-center text-white bg-white/5 border border-white/10 hover:bg-white/10 transition-all sm:hidden">
              <Icon name="log-in" className="w-4 h-4" /> Sign In
            </Link>
          ) : null}
        </div>
      </aside>
    </div>

    {/* Mobile account menu — same right-drawer pattern as the hamburger, so the
       two triggers behave consistently. Rendered outside <nav> because the nav's
       backdrop-filter would otherwise trap position:fixed. Only mounts when
       signed in; at lg+ the anchored dropdown above is used instead. */}
    {isIn ? (
      <div
        ref={acctDrawerRef}
        className={'lg:hidden fixed inset-0 z-[80] transition-opacity duration-300 ' + (acctOpen ? 'opacity-100' : 'opacity-0 pointer-events-none')}
        aria-hidden={!acctOpen}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAcctOpen(false)} />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Account"
          className={'absolute top-0 right-0 h-full w-[300px] max-w-[85vw] bg-[#15122a] border-l border-white/10 shadow-2xl shadow-black/50 flex flex-col transition-transform duration-300 ease-out ' + (acctOpen ? 'translate-x-0' : 'translate-x-full')}
        >
          <div className="flex items-center justify-between gap-2 px-4 h-16 border-b border-white/5 shrink-0">
            {acctIdentity}
            <button onClick={() => setAcctOpen(false)} aria-label="Close menu" className="p-2 -mr-2 rounded-xl hover:bg-white/5 transition-all shrink-0">
              <Icon name="x" className="w-5 h-5 text-gray-300" />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Account">
            {acctOpen && acctItems(() => setAcctOpen(false))}
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
