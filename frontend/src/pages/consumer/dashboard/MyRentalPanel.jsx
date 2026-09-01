import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import PropertyImage from '../../../components/ui/PropertyImage.jsx';
import HScroll from '../../../components/ui/HScroll.jsx';
import { Card, SectionHead } from './components.jsx';
import { fmtINR } from '../../../lib/format.js';
import {
  toRentalCards, tenancyStatus,
} from '../../../lib/data/tenancy.js';
import {
  myTenantProfile, myTenancies, myRentAgreements,
} from '../../../services/rentService.js';
import { inviteRouteFor } from '../../../lib/serviceRequestStatus.js';
import { listMyServiceRequestInvites } from '../../../services/serviceRequestService.js';

/* "My Rental" — the tenant mirror of My Properties. One hub for the home you rent:
   its lease at a glance, when the next rent falls due, and one-tap access to the
   rent-agreement flow, plus your Verified-Tenant score. Source of truth is the
   tenant's finalised tenancy, not owner-side managed props.

   No rent moves through the platform, so there is no payment history and no HRA receipt to hand
   out here — a receipt is a document the tenant files with their employer, and the platform has no
   evidence any money changed hands. A tenant who wants their rent on the dashboard records it
   themselves in the Finances tab, where it is plainly their own figure. */
export default function MyRentalPanel({ user }) {
  const [tenancies, setTenancies] = useState([]);
  const [idx, setIdx] = useState(0);
  /* Whether the reads have come back at all. Without this the empty state below renders on the
     first paint of every visit, so a tenant who *does* have a tenancy is told for a moment that
     they have none — and if `myTenancies()` rejects, that momentary lie becomes a permanent one
     indistinguishable from the truth. */
  const [loaded, setLoaded] = useState(false);

  const t = tenancies[idx] || tenancies[0] || null;

  /* The tenant's own tenancy, profile and agreements — four caller-scoped reads, issued together
     because none depends on another and the panel blocks on all of them. */
  const [rent, setRent] = useState({ profile: null, agreements: [] });
  const [invites, setInvites] = useState([]);
  useEffect(() => {
    let alive = true;
    Promise.all([
      myTenancies().catch(() => []),
      myTenantProfile().catch(() => null),
      myRentAgreements().catch(() => []),
      /* Sixth caller-scoped read, and the reason this is a request rather than a local lookup:
         the invitation is a row the *owner* created against this account, so this browser has
         never seen it. Reading it from `localStorage` meant the card below could only appear to
         someone who had already been invited in this same browser — that is, never. */
      listMyServiceRequestInvites().catch(() => []),
    ]).then(async ([rows, profileRow, agreementRows, inviteRows]) => {
      if (!alive) return;
      const cards = await toRentalCards(rows);
      if (!alive) return;
      setTenancies(cards);
      setInvites((inviteRows || [])
        .filter((row) => row?.status === 'invited')
        .map((row) => ({
          inviteId: row.id,
          fromName: row.invitedBy,
          href: inviteRouteFor(row),
        })));
      setRent({
        profile: profileRow,
        agreements: agreementRows || [],
      });
      setLoaded(true);
    })
      // The individual reads already swallow their own rejections, so reaching here means the card
      // hydration itself failed. Release the gate anyway: a permanent skeleton is no kinder than
      // the empty state, and it gives the tenant nothing to act on.
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
    // Keyed on the mobile rather than the user object: the background /auth/me refresh replaces
    // the object on every tick, and re-issuing five reads for an unchanged identity would re-flash
    // this panel for nothing.
  }, [user?.mobile]);

  // Lease dates only. Nothing here knows whether the rent was actually paid — that money never
  // touches the platform — so this is a schedule, not a settlement status.
  const status = useMemo(() => (t ? tenancyStatus(t) : null), [t]);

  const agreement = rent.agreements[0] || null;
  const profile = rent.profile;
  // The server computes the score from evidence the client cannot see (verified identity, confirmed
  // tenancies, payment history), so there is nothing to fall back to: until the profile arrives the
  // meter has no number to show.
  const score = profile?.score ?? null;
  // Rent-agreement co-fill requests addressed to this user (owner invited them to
  // add their tenant details). Fetched with the panel's other reads, above.

  /* ---- Still asking. Everything below dereferences `t`, and "no rental" is a claim we are not
     entitled to make until the reads land. ---- */
  if (!loaded) {
    return (
      <div className="space-y-6">
        <Hero />
        <Card className="p-8">
          <div className="h-4 w-40 rounded bg-white/10 animate-pulse" />
          <div className="h-3 w-64 rounded bg-white/5 animate-pulse mt-3" />
          <div className="h-3 w-52 rounded bg-white/5 animate-pulse mt-2" />
        </Card>
      </div>
    );
  }

  /* ---- Empty state: no finalised rental yet ---- */
  if (loaded && !t) {
    return (
      <div className="space-y-6">
        <Hero />
        <PendingInvites invites={invites} />
        <Card className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-brand-teal/10 flex items-center justify-center mx-auto mb-4">
            <Icon name="key-round" className="w-7 h-7 text-brand-teal-3" />
          </div>
          <h2 className="text-white text-lg font-bold">No rental on PuneNest yet</h2>
          <p className="text-gray-400 text-sm mt-1.5 max-w-md mx-auto">
            When you finalise a home you rent through PuneNest, it appears here — with your rent
            record, your agreement and deposit options, all in one place.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
            <Link to="/listings?deal=rent" className="btn-teal px-5 py-2.5 rounded-xl text-white text-sm font-semibold inline-flex items-center gap-2">
              <Icon name="search" className="w-4 h-4" /> Browse rentals
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const leaseLabel = t.leaseStart && t.leaseEnd
    ? `${fmtMonth(t.leaseStart)} – ${fmtMonth(t.leaseEnd)}`
    : 'Lease active';

  return (
    <div className="space-y-6">
      <Hero />
      <PendingInvites invites={invites} />
      {tenancies.length > 1 && (
        <HScroll wrapClassName="-mx-1" className="flex gap-1.5 px-1">
          {tenancies.map((x, i) => (
            <button key={x.id} onClick={() => setIdx(i)} className={'inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 text-sm font-medium transition ' + (i === idx ? 'border-brand-teal/30 bg-brand-teal/15 text-brand-teal' : 'border-transparent bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white')}>
              <Icon name="house" className="w-4 h-4" /> {x.locality || x.title}
            </button>
          ))}
        </HScroll>
      )}

      {/* Rented-home card */}
      <Card className="overflow-hidden">
        <div className="flex flex-col sm:flex-row">
          <PropertyImage src={t.image} alt={t.title} className="w-full sm:w-52 h-40 sm:h-auto object-cover" />
          <div className="flex-1 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-white font-bold text-lg truncate">{t.title}</h2>
                <p className="text-gray-400 text-sm mt-0.5 flex items-center gap-1.5"><Icon name="map-pin" className="w-3.5 h-3.5" /> {t.address}</p>
              </div>
              <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold bg-emerald-500/15 text-emerald-300 flex-shrink-0 capitalize">{t.status === 'active' ? 'Active tenancy' : t.status}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <Fact label="Monthly rent" value={fmtINR(t.rent)} />
              <Fact label="Deposit" value={t.deposit ? fmtINR(t.deposit) : '—'} />
              <Fact label="Lease" value={leaseLabel} />
              <Fact label="Landlord" value={t.ownerName} />
            </div>
          </div>
        </div>
      </Card>

      {/* Next rent due — a schedule derived from the lease, not a settlement status */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-500/15">
            <Icon name="calendar-clock" className="w-6 h-6 text-amber-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm">
              {`Rent for ${fmtMonthName(status.month)}`}
            </p>
            <p className="text-gray-500 text-xs mt-0.5">
              {`Due ${status.nextDueLabel} · ${fmtINR(t.rent)}`}
            </p>
          </div>
          <Link to="/pay-rent" className="px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10">
            <Icon name="calendar-clock" className="w-4 h-4" /> Pay rent · Coming soon
          </Link>
        </div>
      </Card>

      {/* Quick actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ActionTile to="/pay-rent" icon="wallet" title="Pay rent" desc="Pay your landlord in-app" soon />
        <ActionTile to="/services/rent-agreement" icon="file-signature" title="Rent agreement" desc={agreement ? 'Registered · view' : 'Create & e-register'} />
        <ActionTile to="/dashboard?tab=finances" icon="notebook-pen" title="Rent record" desc="Track the rent you already pay" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Where rent history lives now.

            There is no payment history to show: no rent has ever moved through PuneNest, so any
            list here would be empty forever, and an HRA receipt issued from it would be a tax
            document asserting a payment the platform never witnessed. The tenant's own record —
            which is honestly labelled as self-entered — lives in the Finances tab. */}
        <Card className="p-6">
          <SectionHead
            icon="receipt-indian-rupee"
            title="Rent payments"
            sub="Paying rent through PuneNest is coming. Until then, keep your own record so your dashboard and HRA figures stay accurate."
          />
          <div className="rounded-xl bg-white/[0.03] border border-white/8 p-5 text-center">
            <p className="text-gray-400 text-sm">
              Record the rent you already pay your landlord — we'll total it for the year and work
              out your HRA exemption.
            </p>
            <Link to="/dashboard?tab=finances" className="mt-4 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl btn-teal text-white text-sm font-semibold">
              <Icon name="notebook-pen" className="w-4 h-4" /> Open my rent record
            </Link>
          </div>
        </Card>

        {/* Sidebar: landlord + agreement + tenant score */}
        <div className="space-y-6">
          <Card className="p-5">
            <SectionHead icon="user-round" title="Your landlord" />
            <p className="text-white text-sm font-medium">{t.ownerName}</p>
            <p className="text-gray-500 text-xs mt-0.5">Landlord for {t.locality || 'your home'}</p>
            {t.ownerMobile ? (
              <a href={`tel:${t.ownerMobile}`} className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 text-sm font-semibold border border-white/10"><Icon name="phone" className="w-4 h-4" /> Call landlord</a>
            ) : null}
          </Card>

          <Card className="p-5">
            <SectionHead icon="file-signature" title="Rent agreement" />
            {agreement ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 font-semibold border border-emerald-500/20"><Icon name="badge-check" className="w-3.5 h-3.5" /> Registered</span>
                <p className="text-gray-500 text-xs mt-2">{agreement.startDate || ''}{agreement.endDate ? ' → ' + agreement.endDate : ''}</p>
              </>
            ) : (
              <p className="text-gray-400 text-xs">No agreement on record. Register a legally-valid e-agreement — PuneNest handles e-stamp, biometric & doorstep registration.</p>
            )}
            <Link to="/services/rent-agreement" className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl btn-teal text-white text-sm font-semibold"><Icon name="file-text" className="w-4 h-4" /> {agreement ? 'View / renew' : 'Create agreement'}</Link>
          </Card>

          <Card className="p-5">
            <SectionHead icon="shield-check" title="Verified-Tenant score" />
            {/* The score is the server's, so before it arrives there is no number to show. A dash
                says "not known yet"; a 0 would read as "you scored nothing". */}
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5"><span>Trust score</span><span className="text-white font-semibold">{score == null ? '—' : `${score}%`}</span></div>
            <div className="insight-bar"><span style={{ width: `${score || 0}%` }} /></div>
            <p className="text-gray-500 text-xs mt-2.5">A higher score gets you priority with owners. Add your ID, employment and income to boost it.</p>
            <Link to="/dashboard#profile" className="mt-3 inline-flex items-center gap-1.5 text-teal-300 hover:text-teal-200 text-sm font-medium"><Icon name="arrow-right" className="w-4 h-4" /> Complete your profile</Link>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* Pending rent-agreement co-fill requests. The owner started the agreement and
   asked this user to add their tenant details — shown here first, then routed to
   the rent-agreement page (their step only is editable). */
function PendingInvites({ invites }) {
  if (!invites || !invites.length) return null;
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
          <Icon name="file-signature" className="w-5 h-5 text-amber-300" />
        </div>
        <div className="min-w-0">
          <h2 className="text-white font-bold text-base">Action needed: complete your rent agreement</h2>
          <p className="text-gray-400 text-sm mt-0.5">
            {invites.length === 1 ? 'A landlord has' : `${invites.length} landlords have`} invited you to add your tenant details and documents.
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        {invites.map((inv) => (
          <div key={inv.inviteId} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/10">
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">
                From {inv.fromName || 'a PuneNest landlord'}{inv.property ? ` · ${inv.property}` : ''}
              </p>
              <p className="text-gray-500 text-xs mt-0.5">You fill your tenant details; the rest is view-only.</p>
            </div>
            <Link to={inv.href} className="btn-teal px-4 py-2.5 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2 flex-shrink-0">
              <Icon name="pencil" className="w-4 h-4" /> Fill my details
            </Link>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Hero() {
  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-teal-1/15 border border-brand-teal-2/25 text-brand-teal-3 text-xs font-medium"><Icon name="key-round" className="w-3.5 h-3.5" /> For tenants</span>
      </div>
      <h1 className="text-xl sm:text-2xl font-bold text-white">The home you rent</h1>
      {/* Deliberately does not promise online rent payment. The subtitle used to open with "Pay
          rent online with an instant HRA receipt", which is the one thing on this screen a tenant
          cannot do: there is no rail, and the receipt it named would have asserted a payment the
          platform never witnessed. What is left is what the panel actually delivers. */}
      <p className="text-gray-400 text-sm mt-1.5 max-w-2xl">Keep your agreement and deposit sorted, track the rent you already pay, and stay on top of every due date — all in one place.</p>
    </div>
  );
}

const Fact = ({ label, value }) => (
  <div>
    <p className="text-gray-500 text-[11px]">{label}</p>
    <p className="text-white text-sm font-semibold truncate">{value}</p>
  </div>
);

const SoonPill = () => (
  <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-amber-400/15 text-amber-300 font-bold">Soon</span>
);

const ActionTile = ({ to, icon, title, desc, soon }) => (
  <Link to={to} className="glass-card rounded-2xl p-4 hover:bg-white/[0.06] transition group">
    <span className="w-9 h-9 rounded-lg bg-brand-teal/10 flex items-center justify-center mb-2.5 group-hover:bg-brand-teal/20"><Icon name={icon} className="w-5 h-5 text-brand-teal-3" /></span>
    <p className="text-white text-sm font-semibold flex items-center gap-1.5">{title}{soon && <SoonPill />}</p>
    <p className="text-gray-500 text-[12px] mt-0.5">{soon ? 'Coming soon' : desc}</p>
  </Link>
);

/* `YYYY-MM-DD` / `YYYY-MM` → "Mon YYYY" */
function fmtMonth(s) {
  if (!s) return '';
  const [y, m] = String(s).split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}
function fmtMonthName(s) { return fmtMonth(s) || s; }
