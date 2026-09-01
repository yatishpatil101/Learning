import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { Link } from 'react-router';
import { usePricing } from '../../context/PricingContext.jsx';
import { listPlans } from '../../services/planService.js';
import { getDealFees } from '../../services/feesService.js';
import { usePlan } from '../../context/PlanContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * The plan catalogue is the price.
 *
 * These cards used to render `fee('ownerPlanYearly')` — the back-office Fees panel — while
 * `POST /me/subscription` charged whatever the server's plan row said. `SubscribeRequest` carries
 * no price, so the client number never travels: it is a *claim about* the charge, not the charge.
 * When the two disagreed the customer was shown ₹999 and billed ₹2,499.
 *
 * So the server wins, and the Fees panel keeps only the non-plan charges it genuinely owns
 * (rent-agreement platform fee, featured listing). `fee()` stays as the fallback for the moment
 * before the catalogue resolves and for a failed fetch — a pricing page that renders a stale number
 * still converts; one that renders a blank does not.
 *
 * ## The paragraph above named the rent-agreement fee as one the panel "genuinely owns". It does not
 *
 * That sentence was written when this page was flipped to the plan catalogue, and it was true of
 * *featured listing*, which has no server row anywhere. It was never true of the rent-agreement
 * platform fee. `platform_fees('rent')` has carried that figure since the fees domain was built, the
 * rent-agreement sidebar has read it through `feesService` since D150, and the checkout bills from
 * it.
 *
 * Which means this page had exactly the bug its own header describes, on a different number. The
 * seeded `platform_fees` row is **1999**; `FEE_DEFAULTS.rentAgreementPlatform` is **500**. A visitor
 * read "₹500 platform fee" in the panel below and in FAQ 4, clicked through, and met ₹1,999 in the
 * wizard — shown one price, charged another, which is the sentence three paragraphs up.
 *
 * So the fee is fetched from the same `GET /fees` the sidebar reads, and `fee()` survives only as
 * the pre-resolution and failed-fetch fallback, for the same reason it does for the plan cards.
 */
const rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

const FREE_IDS = ['free', 'seeker-free', 'owner-free'];

const seekerPlans = (t, fee) => [
  { id: 'seeker-free', name: t('misc1.plansSeekerFreeName'), price: '₹0', sub: t('misc1.plansSeekerFreeSub'), tag: t('misc1.plansSeekerFreeTag'), feats: [t('misc1.plansSeekerFreeFeat1'), t('misc1.plansSeekerFreeFeat2'), t('misc1.plansSeekerFreeFeat3'), t('misc1.plansSeekerFreeFeat4')], cta: t('misc1.plansSeekerFreeCta'), href: '/listings', pop: false },
  { id: 'seeker-plus', name: t('misc1.plansSeekerPlusName'), price: fee('seekerPlusTopup'), sub: t('misc1.plansSeekerPlusSub'), tag: t('misc1.plansSeekerPlusTag'), feats: [t('misc1.plansSeekerPlusFeat1'), t('misc1.plansSeekerPlusFeat2'), t('misc1.plansSeekerPlusFeat3'), t('misc1.plansSeekerPlusFeat4')], cta: t('misc1.plansSeekerPlusCta'), href: '/checkout?plan=seeker-plus', pop: true, badge: t('misc1.plansSeekerPlusBadge') },
];
const ownerPlans = (t, fee) => [
  { id: 'owner-free', name: t('misc1.plansOwnerFreeName'), price: '₹0', sub: t('misc1.plansOwnerFreeSub'), tag: t('misc1.plansOwnerFreeTag'), feats: [t('misc1.plansOwnerFreeFeat1'), t('misc1.plansOwnerFreeFeat2'), t('misc1.plansOwnerFreeFeat3'), t('misc1.plansOwnerFreeFeat4')], cta: t('misc1.plansOwnerFreeCta'), href: '/list-property', pop: false },
  { id: 'owner2', name: t('misc1.plansOwnerName'), price: fee('ownerPlanYearly'), sub: t('misc1.plansOwnerSub'), tag: t('misc1.plansOwnerTag'), feats: [t('misc1.plansOwnerFeat1'), t('misc1.plansOwnerFeat2'), t('misc1.plansOwnerFeat3'), t('misc1.plansOwnerFeat4')], cta: t('misc1.plansOwnerCta'), href: '/checkout?plan=owner2', pop: true, badge: t('misc1.plansOwnerBadge') },
  { id: 'owner5', name: t('misc1.plansOwnerProName'), price: fee('ownerProYearly'), sub: t('misc1.plansOwnerProSub'), tag: t('misc1.plansOwnerProTag'), feats: [t('misc1.plansOwnerProFeat1'), t('misc1.plansOwnerProFeat2'), t('misc1.plansOwnerProFeat3'), t('misc1.plansOwnerProFeat4')], cta: t('misc1.plansOwnerProCta'), href: '/checkout?plan=owner5', pop: false, badge: t('misc1.plansOwnerProBadge') },
];
/**
 * @param rentFee the published rent-agreement platform fee, already formatted.
 * @param price   resolves a plan slug to the price the customer will actually be charged — the
 *                catalogue row when it has resolved, the configured fee only as a fallback. It is
 *                the same resolver the cards use, passed in for the same reason `fee` was: these
 *                builders run at module scope, so a module-scope read would capture whatever the
 *                bundle shipped with and never hear about a change.
 *
 *                It must be this resolver and not `fee()` directly. `GET /pricing` and `GET /plans`
 *                are two different tables answering two different questions, and on the seeded
 *                catalogue they disagree: the fee schedule says Owner Plus is ₹999 where the
 *                catalogue — the number that is charged — says ₹2,499. An FAQ answering "how much
 *                are the owner plans" from the fee schedule therefore quoted ₹999 directly beneath
 *                a card quoting ₹2,499 for the same plan, and quoted Owner Pro at ₹2,499, which is
 *                Owner Plus's real price. Same page, three numbers, one of them a live mis-quote of
 *                a real charge.
 */
const plansFaqs = (t, rentFee, price) => [
  [t('misc1.plansFaq1Q'), t('misc1.plansFaq1A')],
  [t('misc1.plansFaq2Q'), t('misc1.plansFaq2A')],
  [t('misc1.plansFaq3Q'), t('misc1.plansFaq3A')],
  [t('misc1.plansFaq4Q'), t('misc1.plansFaq4A', { fee: rentFee })],
  [t('misc1.plansFaq5Q'), t('misc1.plansFaq5A', { fee1: price('owner2'), fee2: price('owner5') })],
];

function PlanCard({ p, current }) {
  const { t } = useTranslation();
  const { isIn, role } = useAuth();
  const isFree = FREE_IDS.includes(p.id);
  const isCur = p.id === current || (isFree && FREE_IDS.includes(current));
  const paidCurrent = isCur && !isFree; // a paid plan the user is on → lock the CTA against re-purchase
  // A signed-in user's free tier gets a subtle marker (matched to their role) while
  // keeping the CTA actionable, since the default plan id is 'free' for everyone.
  const roleMatches = p.id === 'owner-free' ? role === 'owner' : p.id === 'seeker-free' ? role !== 'owner' : true;
  const freeCurrent = isCur && isFree && isIn && roleMatches;
  return (
    <div className={'glass rounded-2xl p-6 flex flex-col h-full ' + (p.pop ? 'plan-pop relative' : '')}>
      {p.badge && <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-teal-300 mb-2 px-2 py-0.5 rounded-full bg-teal-500/15 self-start">{p.badge}</span>}
      {freeCurrent && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300 mb-2 px-2 py-0.5 rounded-full bg-emerald-500/15 self-start"><Icon name="check-circle" className="w-3 h-3" /> {t('misc1.plansCurrentPlan')}</span>}
      <h3 className="text-xl font-extrabold">{p.name}</h3>
      <p className="mt-1"><span className="text-3xl font-extrabold">{p.price}</span> <span className="text-gray-500 text-sm">{p.sub}</span></p>
      <p className="text-teal-300 text-sm font-medium mt-1 mb-4">{p.tag}</p>
      <ul className="space-y-2.5 mb-5">
        {p.feats.map((f) => <li key={f} className="flex gap-2 text-sm text-gray-300"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" /> {f}</li>)}
      </ul>
      <div className="mt-auto pt-1">
        {paidCurrent ? (
          <button disabled className="w-full py-2.5 rounded-xl font-semibold text-sm border border-white/10 text-gray-400 cursor-default flex items-center justify-center gap-1.5"><Icon name="check-circle" className="w-4 h-4 text-emerald-400" /> {t('misc1.plansCurrentPlan')}</button>
        ) : (
          <Link to={p.href} className={'block text-center w-full py-2.5 rounded-xl font-semibold text-sm ' + (isFree ? 'btn-outline' : 'btn-teal')}>{p.cta}</Link>
        )}
      </div>
    </div>
  );
}

// Mobile-only: turns a persona's plans into a horizontal swipe carousel so the
// value ladder can be compared by swiping instead of scrolling five full-height
// cards. Cards are 82% wide so the next plan peeks (an affordance to swipe), and
// the dots track / drive position. Desktop keeps the plain grid below.
function PlanCarousel({ plans, current }) {
  const scrollRef = useRef(null);
  const [active, setActive] = useState(0);

  const syncActive = () => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.getBoundingClientRect().left;
    let idx = 0;
    let best = Infinity;
    Array.from(el.children).forEach((c, i) => {
      const d = Math.abs(c.getBoundingClientRect().left - left);
      if (d < best) { best = d; idx = i; }
    });
    setActive(idx);
  };

  // Reset to the first card whenever the persona (plan set) changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: 0 });
    setActive(0);
  }, [plans]);

  const goTo = (i) => {
    const child = scrollRef.current?.children[i];
    if (child) child.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };

  return (
    <div>
      <div
        ref={scrollRef}
        onScroll={syncActive}
        className="flex gap-4 overflow-x-auto no-scrollbar -mx-4 px-4 scroll-px-4 py-3"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {plans.map((p) => (
          <div key={p.id} className="flex-shrink-0 w-[82%]" style={{ scrollSnapAlign: 'start' }}>
            <PlanCard p={p} current={current} />
          </div>
        ))}
      </div>
      {plans.length > 1 && (
        <div className="flex items-center justify-center mt-1">
          {plans.map((p, i) => (
            <button
              key={p.id}
              type="button"
              aria-label={p.name}
              aria-current={i === active ? 'true' : undefined}
              onClick={() => goTo(i)}
              /* The dot is drawn by the inner span; the button around it is the
                 target. The dots themselves were 8x8 — unhittable, on the only
                 control that reveals the Plus and Pro plans on a phone.

                 Deliberately 24x44, not 44x44. Three dots 44px wide would either
                 overlap (ambiguous taps, worse than small ones) or have to be
                 spread far enough apart that they stop reading as one indicator.
                 24px is the WCAG 2.5.8 AA floor and, with the row's spacing, puts
                 adjacent centres 32px apart. Height is free, so it takes the full
                 44px. Swiping the rail remains the primary interaction; these are
                 indicators that happen to be tappable.

                 data-tap-exempt records that as reviewed rather than missed: the
                 mobile sweep holds the rest of the app to 44px, and without the
                 marker this rail reads as an oversight every time someone runs it.
                 The 2.5.8 spacing exception is what the pass rests on — 32px
                 between adjacent centres clears the 24px offset it asks for. */
              data-tap-exempt
              className="grid h-11 w-6 place-items-center"
            >
              <span
                aria-hidden="true"
                className={'block h-2 rounded-full transition-all ' + (i === active ? 'w-6 bg-teal-400' : 'w-2 bg-white/25')}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Plans() {
  const { t } = useTranslation();
  const { role } = useAuth();
  // The platform's own price list, from `GET /pricing`. This is the fallback the catalogue reads
  // below fall through to — it used to be a constant compiled into the bundle, which meant a page
  // whose whole purpose is to quote a price quoted one nobody could change.
  const { fee } = usePricing();
  // The plan the caller holds, from the same context the paywall and the Feature action read, so
  // the "Current plan" lock on a card cannot disagree with the entitlement it implies.
  const { planId: current } = usePlan();
  // The live catalogue, keyed by slug. Empty until it resolves and after a failure; both cases
  // fall through to `fee()` below.
  const [catalogue, setCatalogue] = useState({});
  useEffect(() => {
    let alive = true;
    listPlans()
      .then((rows) => {
        if (!alive) return;
        const byslug = {};
        rows.forEach((r) => { if (r.slug) byslug[r.slug] = r; });
        setCatalogue(byslug);
      })
      // A pricing page that cannot reach the catalogue still has to render — it is the page that
      // exists to convert. It falls back to the configured fee rather than showing nothing.
      .catch(() => { if (alive) setCatalogue({}); });
    return () => { alive = false; };
  }, []);
  // The rent-agreement platform fee, from the same published schedule the wizard's sidebar and the
  // checkout read. Null until it resolves and after a failure; both fall through to `fee()`.
  // Deliberately a second request rather than something folded into the plan catalogue: these are
  // two different tables on the server (`plans` and `platform_fees`) answering two different
  // questions, and pretending otherwise here is how the numbers drifted apart in the first place.
  const [rentPlatformFee, setRentPlatformFee] = useState(null);
  useEffect(() => {
    let alive = true;
    getDealFees('rent')
      .then((row) => { if (alive && row && row.platformFee != null) setRentPlatformFee(row.platformFee); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  /**
   * The published fee, formatted, or the configured fallback. A `null` `platformFee` is treated as
   * unpublished rather than free — `feesService`'s header is explicit that null means "not
   * published, not zero", and a marketing page that renders ₹0 for an unpublished charge is a
   * worse lie than a stale one.
   */
  const RENT_FEE = rentPlatformFee == null ? fee('rentAgreementPlatform') : rupees(rentPlatformFee);
  /** Server price when the catalogue has this plan, otherwise the card's configured fallback. */
  const priced = (p) => (catalogue[p.id] ? { ...p, price: rupees(catalogue[p.id].price) } : p);
  const SEEKER = seekerPlans(t, fee).map(priced);
  const OWNER = ownerPlans(t, fee).map(priced);
  /**
   * The charged price for a plan slug, formatted — for prose that quotes a price outside a card.
   * Reads the catalogue first and falls back to the configured fee only while it is unreachable,
   * so a sentence about a plan cannot quote a different number than the card for that plan.
   */
  const priceOf = (slug) => (catalogue[slug]
    ? rupees(catalogue[slug].price)
    : fee(slug === 'owner5' ? 'ownerProYearly' : 'ownerPlanYearly'));
  const FAQS = plansFaqs(t, RENT_FEE, priceOf);
  // On mobile the two persona sections collapse into a single toggle so the user
  // only sees the plans relevant to them — default to their role (seeker-first for
  // signed-out visitors, who are almost always searching).
  const [persona, setPersona] = useState(role === 'owner' ? 'owner' : 'seeker');
  const personas = [
    { key: 'seeker', label: t('misc1.plansForSeekers'), icon: 'search' },
    { key: 'owner', label: t('misc1.plansForOwners'), icon: 'building-2' },
  ];
  const activePlans = persona === 'owner' ? OWNER : SEEKER;
  return (
    <div className="pt-8 sm:pt-10 pb-20 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="text-center mb-8 sm:mb-12">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-emerald-300 mb-3" style={{ background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.25)' }}><Icon name="hand-coins" className="w-3.5 h-3.5" /> {t('misc1.plansBadge')}</span>
        <h1 className="text-3xl sm:text-4xl font-extrabold">{t('misc1.plansTitle')}</h1>
        <p className="text-gray-400 mt-2">{t('misc1.plansSubtitle')}</p>
      </div>

      {/* Mobile: persona toggle + swipeable plan carousel */}
      <div className="md:hidden mb-12">
        <div className="deal-seg flex w-full p-1 rounded-full glass border border-white/10 mb-2" role="radiogroup" aria-label={t('misc1.plansTitle')}>
          {personas.map((o) => {
            const on = persona === o.key;
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => { if (!on) setPersona(o.key); }}
                className={'deal-seg-btn flex-1 inline-flex items-center justify-center gap-1.5 h-11 sm:h-10 px-3 rounded-full text-sm font-semibold t-all ' + (on ? 'is-active' : 'text-gray-400 hover:text-white')}
              >
                <Icon name={o.icon} className="w-4 h-4" /> {o.label}
              </button>
            );
          })}
        </div>
        <PlanCarousel plans={activePlans} current={current} />
      </div>

      {/* Desktop: both persona sections as grids */}
      <div className="hidden md:block">
        <section className="mb-12">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4 flex items-center gap-2"><Icon name="search" className="w-4 h-4 text-teal-400" /> {t('misc1.plansForSeekers')}</h2>
          <div className="grid md:grid-cols-2 gap-5">{SEEKER.map((p) => <PlanCard key={p.id} p={p} current={current} />)}</div>
        </section>

        <section className="mb-12">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4 flex items-center gap-2"><Icon name="building-2" className="w-4 h-4 text-teal-400" /> {t('misc1.plansForOwners')}</h2>
          <div className="grid md:grid-cols-3 gap-5">{OWNER.map((p) => <PlanCard key={p.id} p={p} current={current} />)}</div>
        </section>
      </div>

      <section className="glass rounded-2xl p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center gap-5 mb-10">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(20,184,166,.14)' }}><Icon name="file-signature" className="w-6 h-6 text-teal-400" /></div>
        <div className="flex-1">
          <h2 className="text-lg font-bold">{t('misc1.plansRentAgreement')}</h2>
          <p className="text-gray-400 text-sm mt-1">{t('misc1.plansRentAgreementBody1')}<span className="text-white font-semibold">{RENT_FEE}</span> <span className="text-white font-semibold">{t('misc1.plansPlatformFee')}</span>{t('misc1.plansRentAgreementBody2')}<span className="text-white font-semibold">{t('misc1.plansGovtCharges')}</span>{t('misc1.plansRentAgreementBody3')}</p>
        </div>
        <Link to="/services/rent-agreement" className="btn-teal px-5 py-2.5 rounded-xl font-semibold text-sm text-center whitespace-nowrap flex-shrink-0">{t('misc1.plansCreateRentAgreement')}</Link>
      </section>

      <section className="mb-12">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4 flex items-center gap-2"><Icon name="help-circle" className="w-4 h-4 text-teal-400" /> {t('misc1.plansFrequentlyAsked')}</h2>
        <div className="space-y-3">
          {FAQS.map(([q, a]) => (
            /* The card held the vertical padding and the summary held none, so the
               question was a 20px-tall target sitting in the middle of a 52px row
               with 16px of dead card above and below it — the padding looked like
               part of the control and wasn't. Moving py-4 onto the summary hands
               that space to the thing you actually tap; the card measures the same
               open or closed, so nothing moves on the page. */
            <details key={q} className="glass rounded-xl px-5">
              <summary className="flex items-center justify-between cursor-pointer font-medium text-sm py-4 min-h-[44px]">{q}<Icon name="chevron-down" className="faq-chevron w-4 h-4 text-gray-400 transition-transform flex-shrink-0" /></summary>
              <p className="text-gray-400 text-sm mt-3 pb-4 leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="text-center text-gray-500 text-sm">{t('misc1.plansFooter1')}<span className="text-gray-300 font-medium">{t('misc1.plansFooterBold')}</span></p>
    </div>
  );
}
