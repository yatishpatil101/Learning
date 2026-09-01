import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import '../../styles/routes/services-hub.css';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { createTicket, joinServiceWaitlist } from '../../services/ticketService.js';
import { getMovePack } from '../../services/settingsService.js';
import MobileField from '../../components/MobileField.jsx';
import FieldError from '../../components/ui/FieldError.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import { isValidMobile } from '../../lib/hooks.js';
import { srcSetFor, CARD_SIZES } from '../../lib/imgSrcSet.js';

const IMG = (id) => `https://images.unsplash.com/photo-${id}?w=800&q=80`;

const CATS = [
  ['all', 'All Services', 'layout-grid'],
  ['discover', 'Discover & Decide', 'search'],
  ['finance', 'Finance & Legal', 'wallet'],
  ['move', 'Move & Setup', 'truck'],
];
const SPOT_CHIPS = ['govt', 'doorstep', 'fast'];
/* Rent Agreement leads the list — it is the platform's primary paid service, so it
   holds the first grid slot on every category and renders with the featured treatment. */
const FEATURED_SLUG = 'rentAgreement';
const SERVICES = [
  ['Rent Agreement', 'file-signature', 'finance', '1521791136064-7986c2920216', 'Hassle-free online Maharashtra rent agreements with doorstep biometric.', '/services/rent-agreement', 'rentAgreement'],
  ['Buy a Home', 'home', 'discover', '1600596542815-ffad4c1539a9', 'Browse 10,000+ verified, RERA-compliant listings across Pune with genuine photos.', '/listings?deal=buy', 'buyHome'],
  ['Rent a Home', 'key-round', 'discover', '1502672260266-1c1ef2d93688', 'Owner-direct rentals with zero brokerage and instant visit scheduling.', '/listings?deal=rent', 'rentHome'],
  ['Locality Insights', 'trending-up', 'discover', '1486406146926-c627a92ad1ab', 'Price trends, livability scores and connectivity for every Pune locality.', '/locality/baner', 'localityInsights'],
  ['Home Loans & EMI', 'badge-percent', 'finance', '1554224155-6726b3ff858f', 'Compare rates from 25+ banks, check eligibility and plan repayments with a built-in EMI calculator.', '/home-loans', 'homeLoans'],
  ['Property & Legal', 'scale', 'finance', '1589829545856-d10d557cf95f', 'Title verification, due diligence and end-to-end registration assistance.', '/services/property-legal', 'propertyLegal'],
  ['Packers & Movers', 'truck', 'move', '1600518464441-9154a4dea21b', 'Vetted relocation partners at negotiated, transparent, all-inclusive rates.', '/services/packers-movers', 'packersMovers'],
  ['Interior & Renovation', 'paint-roller', 'move', '1618221195710-dd6b41faaea6', 'Designed-in-3D interiors by trusted partners with a 10-year warranty.', '/services/interior-renovation', 'interior'],
  ['Property Valuation', 'calculator', 'discover', '1460925895917-afdab827c52f', 'Get a fair, data-backed estimate and a certified valuation report in 48 hours.', '/services/property-valuation', 'valuation'],
];
const STEPS = [
  ['Search', 'search', 'Filter by locality, budget, BHK, age, floor and amenities.', 'search'],
  ['Shortlist', 'heart', 'Save favourites, compare side by side and view on the map.', 'shortlist'],
  ['Visit & Decide', 'calendar-check', 'Book site visits and chat directly with verified owners.', 'visit'],
  ['Move In', 'key-round', 'Close with loans, legal, movers & interiors — all sorted.', 'moveIn'],
];
const TESTI = [
  ['Aarti & Rohan', 'Bought a 3 BHK in Baner', 'AR', 'We found our flat, got the loan and even the movers — all through Draazy. Zero brokerage, zero stress.', '#fb923c'],
  ['Sandeep Kulkarni', 'Rented in Wakad', 'SK', 'Chatted directly with the owner, signed the rent agreement online. The whole thing took two days.', '#14b8a6'],
  ['Meera Joshi', 'Sold & relocated', 'MJ', 'The valuation report and legal help made selling effortless. Interiors team set up our new home beautifully.', '#6366f1'],
];
const PACK = [
  { id: 'movers', icon: 'truck' },
  { id: 'clean', icon: 'sparkles' },
  { id: 'agreement', icon: 'file-signature' },
  { id: 'paint', icon: 'paint-roller' },
  { id: 'verify', icon: 'shield-check' },
  { id: 'internet', icon: 'wifi' },
];
/* The pack's prices used to be duplicated here as a fallback. They now live in the `movePack`
   settings block and are seeded server-side, which is the point: a client-side copy is exactly the
   second source of truth that let this page disagree with the admin console for as long as it did.
   Nothing renders a price before the server has answered, so there is nothing left to fall back
   to. */
const STAT_BAND = [
  { to: 10000, suffix: '+', label: 'Verified Properties', slug: 'verifiedProperties' },
  { to: 5000, suffix: '+', label: 'Happy Families', slug: 'happyFamilies' },
  { to: 10, suffix: '+ Services', label: 'Under One Roof', slug: 'underOneRoof' },
  { to: 0, prefix: '₹', label: 'Brokerage Charged', slug: 'brokerageCharged' },
];

const fmtCount = (v) => {
  if (v < 1000) return v;
  const k = v / 1000;
  return (Number.isInteger(k) ? k : k.toFixed(1)) + 'K';
};

function Counter({ to, prefix = '', suffix = '', run }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return undefined;
    const dur = 1300;
    let raf;
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min((t - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(to * e));
      if (p < 1) raf = requestAnimationFrame(step);
      else setV(to);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [run, to]);
  return <p className="text-2xl sm:text-3xl font-extrabold gradient-text">{prefix}{fmtCount(v)}{suffix}</p>;
}

/* The admin-controlled Move-in Pack config, read through the settings seam (`GET /move-pack`).

   This used to read `rawDb().settings.movePack` directly out of local storage, which meant the
   settings domain going live changed nothing here: an operator could publish the pack, be told it
   saved -- it did save -- and watch this page carry on saying "coming soon". The write was real and
   the read was not.

   It starts in coming-soon mode rather than optimistically live, and it stays there if the fetch
   fails. That is the only safe direction for configuration that decides whether to take money:
   showing the pack a beat late costs a launch nothing, while quoting prices the server never
   confirmed is a checkout nobody authorised. There is no flash of stale prices either way, because
   the price list is only rendered once `enabled` is true.

   The two listeners survive the move. They are what lets an admin flipping the switch reflect
   without a reload, which against localStorage was the whole mechanism and live is still how the
   same-browser case behaves. */
function useMovePackConfig() {
  const [cfg, setCfg] = useState({ enabled: false, items: {} });
  useEffect(() => {
    let live = true;
    const sync = () => {
      getMovePack()
        .then((next) => { if (live) setCfg(next); })
        // Swallowed on purpose: the fallback already in state *is* the failure behaviour, and a
        // toast about a config read is noise to a visitor who has not asked for anything yet.
        .catch(() => {});
    };
    sync();
    window.addEventListener('draazy-settings-change', sync);
    window.addEventListener('storage', sync);
    return () => {
      live = false;
      window.removeEventListener('draazy-settings-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return cfg;
}

export default function Services() {
  const { t: tr } = useTranslation();
  const rootRef = useScrollReveal();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isIn } = useAuth();
  const { toast } = useToast();
  const [cat, setCat] = useState('all');
  const [packSel, setPackSel] = useState({});
  /* Both, not either: the ref closes the window between the click and the re-render, and the
     state is what actually disables the button. The booking is a POST that mints a ticket, so a
     double click on a slow connection is two leads for one move. */
  const [booking, setBooking] = useState(false);
  const bookingRef = useRef(false);
  const [countRun, setCountRun] = useState(false);
  const statRef = useRef(null);
  const svcGridRef = useRef(null);

  // Move-in Pack: admin-controlled prices + launch state. When not enabled the
  // section runs in "coming soon" mode (prices hidden, waitlist capture instead of booking).
  const movePack = useMovePackConfig();
  const packLive = movePack.enabled;
  const [notify, setNotify] = useState({ name: '', mobile: '' });
  const [notifyErr, setNotifyErr] = useState('');
  const [notified, setNotified] = useState(false);
  useEffect(() => {
    if (isIn) setNotify((n) => ({ name: n.name || user?.name || '', mobile: n.mobile || user?.mobile || '' }));
  }, [isIn, user]);

  // Deal-finalization: congrats banner + highlight the relevant service
  const finalize = searchParams.get('finalize');
  const focus = searchParams.get('focus');
  const [showFinalizeBanner, setShowFinalizeBanner] = useState(false);
  const [bannerTitle, setBannerTitle] = useState('');
  const [bannerSub, setBannerSub] = useState('');

  useEffect(() => {
    if (finalize) {
      setShowFinalizeBanner(true);
      if (finalize === 'rent') {
        setBannerTitle(tr('services.hub.finalizeRentTitle'));
        setBannerSub(tr('services.hub.finalizeRentSub'));
      } else {
        setBannerTitle(tr('services.hub.finalizeSaleTitle'));
        setBannerSub(tr('services.hub.finalizeSaleSub'));
      }
    }
  }, [finalize, tr]);

  // Deep-link to service card when ?focus=<id> is present
  useEffect(() => {
    if (!focus && !finalize) return;
    const focusMap = { 'rent-agreement': '/services/rent-agreement', 'legal': '/services/property-legal', 'home-loans': '/home-loans' };
    const targetHref = focusMap[focus] || (finalize === 'rent' ? '/services/rent-agreement' : '/services/property-legal');
   
    const timer = setTimeout(() => {
      if (svcGridRef.current) {
        const card = svcGridRef.current.querySelector(`a.svc-card[href="${targetHref}"]`);
        if (card) {
          card.classList.add('svc-focus');
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => card.classList.remove('svc-focus'), 4000);
        }
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [focus, finalize]);

  // Start counters when the stat band scrolls into view.
  useEffect(() => {
    const el = statRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { setCountRun(true); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Dynamic Locality Insights link (for now, hardcoded to Baner - could be enhanced to read from user context or selected locality)
  const localitySlug = 'baner'; // In HTML this is hardcoded to 'locality.html', but React uses '/locality/baner'
  const servicesWithDynamicLocality = useMemo(() => {
    return SERVICES.map(([t, ic, c, img, d, href, slug]) => {
      // Update Locality Insights to use dynamic locality
      if (t === 'Locality Insights') {
        return [t, ic, c, img, d, `/locality/${localitySlug}`, slug];
      }
      return [t, ic, c, img, d, href, slug];
    });
  }, [localitySlug]);

  const list = useMemo(() => servicesWithDynamicLocality.filter((s) => cat === 'all' || s[2] === cat), [cat, servicesWithDynamicLocality]);
  const total = PACK.reduce((a, p) => a + (packSel[p.id] ? (movePack.items[p.id] || 0) : 0), 0);
  const save = Math.round(total * 0.12);

  const bookPack = async () => {
    const items = PACK.filter((p) => packSel[p.id]);
    if (!items.length) { toast(tr('services.hub.selectAtLeastOne'), 'error'); return; }
    if (!isIn) { navigate('/signin?next=/services'); return; }
    if (bookingRef.current) return;
    bookingRef.current = true;
    setBooking(true);
    const names = items.map((i) => tr('services.hub.pack.' + i.id));
    const accepted = total - save;
    /* The lead onto the packers desk. `quotedValue` is what this customer assembled line by line
       and accepted, which is not the same fact as ops' `value` and is why the board needed a second
       column (D3): before it existed there was nowhere to put this number, so in live mode the
       whole booking was dropped and the customer got a success toast for a lead nobody received.

       An `addServiceOrder({ type: 'move-in-pack', … })` used to run above this, unconditionally, in
       both modes. It wrote a localStorage row that no screen read — `getServiceOrders()` had no
       callers — so the booking existed twice in mock mode and the copy that was not the lead was
       the copy nobody could see. `POST /me/service-orders` is deliberately not its replacement:
       that endpoint takes a single catalogue offering and refuses an amount, because the customer
       does not name the price there. A move-in pack is a bundle the customer assembled and a figure
       they accepted, which is exactly what `quotedValue` on the ticket is for.

       Contact details are not sent — unlike the interior and valuation forms, this one never asks
       for them; the server copies them off the authenticated session, which is why the sign-in
       redirect above happens before anything is written rather than after.

       There is no mock branch, and the toast waits on the server — the same two corrections
       `submitNotify` below already carries, for the same reason. A `!isHttpDomain('ticket')` arm
       used to write the booking to `lib/mockApi`, and the success toast then fired outside the
       branch, so it also fired when the live `createTicket` rejected: an unreachable server and a
       failed one both ended in "Move-in Pack booked! Our team will call to schedule." The
       selection is deliberately left standing on failure — it is six checkboxes and a price the
       customer worked out, and clearing it would make the retry a re-do. */
    try {
      await createTicket({
        subject: 'Move-in Pack booking',
        team: 'packers',
        body: names.join(', '),
        quotedValue: accepted,
      });
    } catch {
      toast(tr('services.hub.packFailed'), 'error');
      return;
    } finally {
      bookingRef.current = false;
      setBooking(false);
    }
    setPackSel({});
    toast(tr('services.hub.packBookedToast'), 'success');
  };

  /* Coming-soon waitlist: a real lead onto the same packers desk the live Book flow above uses.
     No forced sign-up — the point of this form is somebody who has not decided whether this
     company is worth an account, and asking them to make one before we will agree to ring them
     back is the wrong order. All we need is a number to call.

     This used to write to browser localStorage and then show the success toast unconditionally,
     which is the worst version of the bug: nobody saw an error, and the person believed they were
     on a list that did not exist. So the await is the fix, not decoration — `setNotified` and the
     toast now happen only if the server said yes. `service` is the only thing sent about *what*
     they want; the desk, the subject and the priority are derived server-side precisely so this
     open form cannot page an arbitrary team.

     There is no mock branch. The ticket domain is live-only by design (see ticketService.js), and
     a mock fallback here would be the localStorage behaviour again under a new name. In mock mode
     the form says it could not do it, which is true. */
  const submitNotify = async (e) => {
    e.preventDefault();
    const mob = (notify.mobile || '').replace(/\D/g, '');
    if (!isValidMobile(mob)) { setNotifyErr(tr('services.hub.notifyMobileErr')); return; }
    setNotifyErr('');
    try {
      await joinServiceWaitlist({ service: 'move-in-pack', name: notify.name?.trim() || user?.name || '', mobile: mob });
    } catch {
      setNotifyErr(tr('services.hub.notifyFailed'));
      return;
    }
    setNotified(true);
    toast(tr('services.hub.notifyToast'), 'success');
  };

  return (
    <div ref={rootRef}>
      <div>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1600&q=80')" }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(120deg,rgba(15,13,26,.97) 0%,rgba(30,27,75,.88) 45%,rgba(13,148,136,.5) 100%)' }} />
          <div className="absolute -top-20 -right-20 w-96 h-96 rounded-full bg-[#14b8a6]/20 blur-3xl" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 lg:py-28">
            <div className="max-w-2xl reveal">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-xs text-teal-200 font-medium mb-5"><Icon name="sparkles" className="w-3.5 h-3.5" /> {tr('services.hub.heroBadge')}</span>
              <h1 className="text-4xl sm:text-6xl font-extrabold leading-[1.05]">{tr('services.hub.heroTitle1')}<br /><span className="gradient-text">{tr('services.hub.heroTitleAccent')}</span></h1>
              <p className="text-gray-200 text-base sm:text-lg mt-3 sm:mt-5 max-w-xl">{tr('services.hub.heroSubtitle')}</p>
              {/* Single row on mobile too — the pair reads as one choice, and keeping it
                  on one line lifts the fold so the Rent Agreement spotlight stays visible. */}
              <div className="hero-cta-row flex flex-row gap-2 sm:gap-3 mt-5 sm:mt-8">
                <a href="#services" className="btn btn-primary btn-lg sm:min-w-[200px]"><Icon name="layout-grid" className="w-4 h-4 shrink-0" /> {tr('services.hub.exploreServices')}</a>
                <Link to="/listings?deal=buy" className="btn btn-secondary btn-lg sm:min-w-[200px]"><Icon name="search" className="w-4 h-4 shrink-0" /> {tr('services.hub.browseProperties')}</Link>
              </div>
            </div>
          </div>
        </section>

        {/* Rent Agreement spotlight — the primary paid service takes the prime slot
            directly under the hero (where the stat band used to sit). */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 sm:-mt-10 relative z-10">
          <Link to="/services/rent-agreement" className="ra-spot glass-card block rounded-2xl p-4 sm:p-6 reveal">
            <div className="flex items-start gap-3 sm:gap-5">
              <span className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl bg-gradient-to-br from-[#0d9488] to-[#14b8a6] flex items-center justify-center shrink-0 shadow-lg shadow-teal-500/30">
                <Icon name="file-signature" className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold uppercase tracking-wide text-teal-200" style={{ background: 'rgba(20,184,166,.16)' }}>
                  <Icon name="sparkles" className="w-3 h-3" /> {tr('services.hub.spotlight.badge')}
                </span>
                <h2 className="text-lg sm:text-2xl font-extrabold text-white mt-2 leading-tight">{tr('services.hub.spotlight.title')}</h2>
                <p className="text-gray-300 text-xs sm:text-sm mt-1.5 leading-relaxed">{tr('services.hub.spotlight.sub')}</p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {SPOT_CHIPS.map((k) => (
                    <span key={k} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-gray-300">
                      <Icon name="check" className="w-3 h-3 text-teal-300 shrink-0" /> {tr('services.hub.spotlight.chip.' + k)}
                    </span>
                  ))}
                </div>
                <span className="btn btn-primary btn-lg w-full sm:w-auto mt-4">
                  <Icon name="file-signature" className="w-4 h-4 shrink-0" /> {tr('services.hub.spotlight.cta')}
                  <Icon name="arrow-right" className="w-4 h-4 shrink-0" />
                </span>
              </div>
            </div>
          </Link>
        </section>

        {/* Services */}
        <section id="services" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-y">
          {/* Finalize Banner */}
          {showFinalizeBanner && (
            <div className="glass-card rounded-2xl p-5 mb-8 flex items-center gap-4 border border-emerald-500/25 reveal" style={{ background: 'rgba(16,185,129,.08)' }}>
              <div className="w-12 h-12 rounded-xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                <Icon name="party-popper" className="w-6 h-6 text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold">{bannerTitle}</p>
                <p className="text-gray-400 text-sm mt-0.5">{bannerSub}</p>
              </div>
            </div>
          )}

          <div className="text-center mb-8 reveal">
            <h2 className="text-2xl sm:text-3xl font-bold">{tr('services.hub.ourServices')}</h2>
            <p className="text-gray-400 text-sm mt-2 max-w-2xl mx-auto">{tr('services.hub.ourServicesSub')}</p>
          </div>
          <HScroll wrapClassName="mb-8 sm:mb-10 -mx-4 sm:mx-0 reveal" className="flex sm:flex-wrap justify-start sm:justify-center items-center gap-2 px-4 sm:px-0 sm:overflow-visible" fadeWidth="2rem">
            {CATS.map(([key, label, icon]) => (
              <button key={key} onClick={() => setCat(key)} className={'cat-tab shrink-0 px-4 py-2 min-h-[44px] rounded-full text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap ' + (cat === key ? 'on' : 'text-gray-300 bg-white/5 hover:bg-white/10')}>
                <Icon name={icon} className="w-4 h-4" /> {tr('services.hub.cat.' + key)}
              </button>
            ))}
          </HScroll>
          <div ref={svcGridRef} className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
            {list.map(([t, ic, c, img, d, href, slug], i) => {
              const cardName = tr('services.hub.card.' + slug + '.name');
              const featured = slug === FEATURED_SLUG;
              const Inner = (
                <>
                  <div className="zoom relative h-40 sm:h-44">
                    <img src={IMG(img)} srcSet={srcSetFor(IMG(img))} sizes={CARD_SIZES} alt={cardName} className="w-full h-full object-cover" loading="lazy" />
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(8,7,16,.1) 40%,rgba(8,7,16,.65) 100%)' }} />
                    {/* Mobile: stronger bottom scrim so the overlaid title stays legible */}
                    <div className="absolute inset-0 sm:hidden" style={{ background: 'linear-gradient(180deg,rgba(8,7,16,0) 34%,rgba(8,7,16,.55) 62%,rgba(8,7,16,.9) 100%)' }} />
                    <div className="absolute top-2.5 left-2.5 sm:top-3 sm:left-3 w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-[#0d9488] to-[#14b8a6] flex items-center justify-center shadow-lg shadow-teal-500/30"><Icon name={ic} className="w-4 h-4 sm:w-5 sm:h-5 text-white" /></div>
                    <span className={'absolute top-2.5 right-2.5 sm:top-3 sm:right-3 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full backdrop-blur ' + (featured ? 'svc-ribbon text-white' : 'bg-black/45 text-teal-100')}>{featured ? tr('services.hub.mostBooked') : tr('services.hub.catBadge.' + c)}</span>
                    {/* Mobile: title integrated onto the image, image fills the whole tile */}
                    <div className="absolute inset-x-0 bottom-0 p-3 flex items-end justify-between gap-2 sm:hidden">
                      <h3 className="text-white font-bold text-sm leading-tight line-clamp-2 drop-shadow-sm">{cardName}</h3>
                      <span className="lm w-7 h-7 rounded-full bg-white/15 backdrop-blur flex items-center justify-center shrink-0"><Icon name="arrow-right" className="w-4 h-4" /></span>
                    </div>
                  </div>
                  {/* Desktop: image + description below (unchanged) */}
                  <div className="hidden sm:block p-5">
                    <h3 className="text-white font-bold text-base leading-snug line-clamp-2 mb-1.5">{cardName}</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">{tr('services.hub.card.' + slug + '.desc')}</p>
                    <span className="lm inline-flex items-center text-sm font-semibold mt-4">{tr('services.hub.learnMore')}&nbsp;<Icon name="arrow-right" className="w-4 h-4" /></span>
                  </div>
                </>
              );
              const cls = 'svc-card svc-pop glass-card rounded-2xl overflow-hidden block' + (featured ? ' svc-featured' : '');
              const style = { animationDelay: `${i * 45}ms` };
              // key includes `cat` so cards remount on category switch -> svc-pop replays
              return href.startsWith('/listings') || href.startsWith('/locality') || href.startsWith('/home-loans') || href.startsWith('/services')
                ? <Link key={`${cat}-${t}`} to={href} className={cls} style={style}>{Inner}</Link>
                : <a key={`${cat}-${t}`} href={href} className={cls} style={style}>{Inner}</a>;
            })}
          </div>
        </section>

        {/* How it works */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="text-center mb-12 reveal"><h2 className="text-2xl sm:text-3xl font-bold">{tr('services.hub.howItWorksTitle')}</h2><p className="text-gray-400 text-sm mt-2">{tr('services.hub.howItWorksSub')}</p></div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
            {STEPS.map(([t, ic, d, slug], idx) => (
              <div key={t} className="step glass-card rounded-2xl p-4 sm:p-6 text-center reveal">
                <div className="step-ic relative w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/20 flex items-center justify-center"><Icon name={ic} className="w-6 h-6 sm:w-7 sm:h-7 text-teal-400" /></div>
                </div>
                <h3 className="text-white font-semibold text-sm sm:text-base flex items-center justify-center gap-1.5"><span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/25 text-teal-300 text-[11px] font-bold shrink-0">{idx + 1}</span><span>{tr('services.hub.step.' + slug + '.t')}</span></h3>
                <p className="text-gray-500 text-xs mt-1.5">{tr('services.hub.step.' + slug + '.d')}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Stats — moved below the fold: these are aspirational numbers, not proof yet,
            so they support the story rather than lead it. */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div ref={statRef} className="glass-card rounded-2xl p-4 sm:p-6 grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 reveal">
            {STAT_BAND.map((s) => (
              <div key={s.label} className="text-center"><Counter to={s.to} prefix={s.prefix} suffix={s.suffix === '+ Services' ? tr('services.hub.stat.servicesSuffix') : s.suffix} run={countRun} /><p className="text-gray-500 text-[11px] sm:text-xs mt-1">{tr('services.hub.stat.' + s.slug)}</p></div>
            ))}
          </div>
        </section>

        {/* Testimonials */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="text-center mb-6 sm:mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold">{tr('services.hub.testimonialsTitle')}</h2></div>
          {/* Mobile: one swipeable rail instead of three stacked cards (saves ~2 screens of scroll) */}
          <HScroll wrapClassName="-mx-4 sm:mx-0 reveal" className="testi-rail flex md:grid md:grid-cols-3 gap-4 sm:gap-5 px-4 sm:px-0 md:overflow-visible" fadeWidth="1.5rem">
            {TESTI.map(([n, r, av, q, col], i) => (
              <div key={n} className="glass-card rounded-2xl p-5 sm:p-6 shrink-0 w-[82%] sm:w-auto md:w-full">
                <div className="flex gap-0.5 mb-3">{Array.from({ length: 5 }).map((_, si) => <Icon key={si} name="star" className="w-4 h-4" style={{ color: '#fbbf24', fill: '#fbbf24' }} />)}</div>
                <p className="text-gray-300 text-sm leading-relaxed">&ldquo;{tr('services.hub.testi.' + i + '.quote')}&rdquo;</p>
                <div className="flex items-center gap-3 mt-5">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ background: col }}>{av}</div>
                  <div><p className="text-white font-semibold text-sm">{n}</p><p className="text-gray-500 text-xs">{tr('services.hub.testi.' + i + '.role')}</p></div>
                </div>
              </div>
            ))}
          </HScroll>
        </section>

        {/* Move-in Pack */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="rounded-2xl p-6 sm:p-8 glass-card reveal" style={{ background: 'linear-gradient(135deg,rgba(13,148,136,.1),rgba(79,70,229,.08))', border: '1px solid rgba(20,184,166,.25)' }}>
            <div className="flex flex-col lg:flex-row gap-6 items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-teal-300" style={{ background: 'rgba(20,184,166,.15)' }}><Icon name="package" className="w-3.5 h-3.5" /> {tr('services.hub.packBadge')}</span>
                  {!packLive && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-amber-300" style={{ background: 'rgba(245,158,11,.15)' }}><Icon name="clock" className="w-3.5 h-3.5" /> {tr('services.hub.packComingSoon')}</span>
                  )}
                </div>
                <h2 className="text-2xl font-bold text-white">{tr('services.hub.packTitle')}</h2>
                <p className="text-gray-300 mt-2 mb-4">{packLive ? tr('services.hub.packDesc') : tr('services.hub.packComingSoonDesc')}</p>
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {PACK.map((p) => {
                    /* An item the server sent no price for is not sellable, rather than sellable
                       at zero. The server drops a malformed price instead of clamping it, so
                       `|| 0` here would undo that on the only screen where it costs money. */
                    const price = movePack.items[p.id];
                    const sellable = packLive && typeof price === 'number';
                    const on = sellable && !!packSel[p.id];
                    return (
                      <button key={p.id} type="button" disabled={!sellable} onClick={() => { if (sellable) setPackSel((s) => ({ ...s, [p.id]: !s[p.id] })); }} className={'flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 min-h-[44px] border text-left transition-all ' + (on ? 'border-teal-400/50 bg-teal-400/10' : 'border-white/10 bg-white/5') + (sellable ? '' : ' cursor-default')}>
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Icon name={p.icon} className={'w-4 h-4 shrink-0 ' + (on ? 'text-teal-300' : 'text-gray-400')} />
                          <span className="min-w-0">
                            <span className="block text-sm text-white truncate">{tr('services.hub.pack.' + p.id)}</span>
                            <span className="block text-[11px] text-gray-500 truncate">{tr('services.hub.packItemDesc.' + p.id)}</span>
                          </span>
                        </span>
                        {sellable && <span className={'text-xs font-semibold shrink-0 ' + (on ? 'text-teal-300' : 'text-gray-500')}>₹{price.toLocaleString('en-IN')}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="w-full lg:w-72 flex-shrink-0 rounded-2xl bg-white/5 border border-white/10 p-5">
                {packLive ? (
                  <>
                    <p className="text-sm text-gray-400">{tr('services.hub.packTotal')}</p>
                    <p className="text-sm text-gray-500 line-through h-5">{total ? '₹' + total.toLocaleString('en-IN') : '\u00A0'}</p>
                    <p className="text-3xl font-extrabold text-white">₹{(total - save).toLocaleString('en-IN')}</p>
                    <p className="text-emerald-300 text-xs mb-4">{total ? tr('services.hub.packSaveNote', { amount: save.toLocaleString('en-IN') }) : '\u00A0'}</p>
                    <button onClick={bookPack} disabled={booking} className="btn-teal w-full py-3 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"><Icon name="check-circle-2" className="w-4 h-4" /> {tr(booking ? 'services.hub.bookingPack' : 'services.hub.bookPack')}</button>
                    <p className="text-gray-500 text-[11px] mt-2 text-center">{tr('services.hub.payAfter')}</p>
                  </>
                ) : notified ? (
                  <div className="text-center py-2">
                    <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-3"><Icon name="check" className="w-6 h-6 text-emerald-400" /></div>
                    <p className="text-white font-bold text-sm">{tr('services.hub.notifyDoneTitle')}</p>
                    <p className="text-gray-400 text-xs mt-1.5">{tr('services.hub.notifyDoneSub')}</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-1"><Icon name="clock" className="w-4 h-4 text-amber-300" /><p className="text-white font-bold text-sm">{tr('services.hub.notifyTitle')}</p></div>
                    <p className="text-gray-400 text-xs mb-4">{tr('services.hub.notifySub')}</p>
                    <form onSubmit={submitNotify} className="space-y-3" noValidate>
                      <input value={notify.name} onChange={(e) => setNotify((n) => ({ ...n, name: e.target.value }))} placeholder={tr('services.hub.notifyNamePlaceholder')} className="field w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500" />
                      <MobileField value={notify.mobile} onChange={(v) => { setNotify((n) => ({ ...n, mobile: v })); if (notifyErr) setNotifyErr(''); }} error={!!notifyErr} />
                      <FieldError show={!!notifyErr}>{notifyErr}</FieldError>
                      <button type="submit" className="btn-teal w-full py-3 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2"><Icon name="bell" className="w-4 h-4" /> {tr('services.hub.notifyBtn')}</button>
                    </form>
                    <p className="text-gray-500 text-[11px] mt-2 text-center">{tr('services.hub.notifyFinePrint')}</p>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="rounded-2xl p-8 sm:p-12 text-center relative overflow-hidden reveal">
            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1400&q=80')" }} />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(120deg,rgba(15,13,26,.95),rgba(49,46,129,.72),rgba(13,148,136,.55))' }} />
            <div className="relative">
              <h2 className="text-2xl sm:text-3xl font-bold">{tr('services.hub.ctaTitle')}</h2>
              <p className="text-gray-200 mt-3 mb-7">{tr('services.hub.ctaSub')}</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link to="/listings" className="btn-teal px-6 py-3.5 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2"><Icon name="search" className="w-4 h-4" /> {tr('services.hub.ctaBrowse')}</Link>
                <Link to="/list-property" className="px-6 py-3.5 rounded-xl bg-white/10 border border-white/20 text-white text-sm font-semibold hover:bg-white/15 inline-flex items-center justify-center gap-2 transition-all"><Icon name="plus" className="w-4 h-4" /> {tr('services.hub.ctaList')}</Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
