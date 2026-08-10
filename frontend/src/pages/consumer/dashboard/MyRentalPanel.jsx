import { useState, useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import HScroll from '../../../components/ui/HScroll.jsx';
import { Card, SectionHead } from './components.jsx';
import { fmtINR } from '../../../lib/format.js';
import {
  loadTenancies, tenancyStatus, seedDemoTenancy, clearDemoTenancy, hasDemoTenancy,
} from '../../../lib/data/tenancy.js';
import {
  getRentAgreements, getTenantProfile, tenantScore,
} from '../../../lib/store.js';
import { myRentPayments, getMandate, myTenantProfile } from '../../../services/rentService.js';
import { generateSingle } from '../../../lib/rentReceipt.js';
import { thisMonth } from '../../../lib/rentPay.js';
import { pendingInvites, invitePath } from '../../../lib/serviceFlow.js';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';

/* "My Rental" — the tenant mirror of My Properties. One hub for the home you rent:
   its lease at a glance, this month's rent status, and one-tap access to the
   existing pay-rent / deposit / rent-agreement flows, plus your payment history
   with HRA receipts and your Verified-Tenant score. Source of truth is the
   tenant's finalised tenancy (pnTenancies), not owner-side managed props. */
export default function MyRentalPanel({ user, toast }) {
  const { flagEnabled } = useAppFlags();
  // Money movement isn't live in the app yet — online rent payment is surfaced as
  // "Coming soon". The /pay-rent route renders an honest coming-soon page (no longer
  // bounces home), so these links point there. Flip the admin flag on to light up the flow.
  const payEnabled = flagEnabled('onlineRentPayment');
  const [tenancies, setTenancies] = useState(() => loadTenancies(user));
  const [idx, setIdx] = useState(0);
  // loadTenancies always returns a fresh array, so setTenancies alone is the
  // re-render signal that flows into the memos below (no extra force counter).
  const refresh = useCallback(() => setTenancies(loadTenancies(user)), [user]);
  useEffect(() => { setTenancies(loadTenancies(user)); }, [user]);

  const t = tenancies[idx] || tenancies[0] || null;
  const status = useMemo(() => (t ? tenancyStatus(t) : null), [t, tenancies]);

  /* The tenant's own payment history, mandate and profile — three caller-scoped reads, issued
     together because none depends on another and the panel blocks on all of them. */
  const [rent, setRent] = useState({ payments: [], mandate: null, profile: null });
  useEffect(() => {
    let alive = true;
    Promise.all([
      myRentPayments(0, 6).catch(() => ({ items: [] })),
      getMandate().catch(() => null),
      myTenantProfile().catch(() => null),
    ]).then(([page, mandateRow, profileRow]) => {
      if (!alive) return;
      setRent({ payments: page?.items || [], mandate: mandateRow, profile: profileRow });
    });
    return () => { alive = false; };
  }, [user, tenancies]);

  const payments = rent.payments;
  const agreement = getRentAgreements()[0] || null;
  const mandate = rent.mandate;
  const profile = rent.profile;
  // The server owns the score. Falling back to the local calculation keeps the meter honest in mock
  // mode and while the first fetch is in flight, rather than showing a hard zero.
  const score = profile?.score ?? tenantScore(getTenantProfile());
  const showDemoReset = hasDemoTenancy();
  // Rent-agreement co-fill requests addressed to this user (owner invited them to
  // add their tenant details). Surfaced here first, then routed to the fill page.
  const invites = useMemo(() => pendingInvites(user?.mobile), [user?.mobile]);

  const loadDemo = () => {
    if (seedDemoTenancy(user)) { toast?.('Demo rental loaded — every feature is now testable.', 'success'); refresh(); }
    else { toast?.('A demo rental is already loaded.', 'info'); }
  };
  const removeDemo = () => { clearDemoTenancy(user); toast?.('Demo rental removed.', 'info'); setIdx(0); refresh(); };

  const downloadReceipt = (p) => {
    try {
      generateSingle({
        tenant: p.tenant || user?.name || 'Tenant', landlord: p.to || t?.ownerName || 'Landlord',
        address: p.address || t?.address || '—', rent: p.amount, pan: p.pan || '',
        mode: p.method || 'UPI', month: p.month || thisMonth(), txnRef: p.id, paidOnline: true,
      });
      toast?.('HRA receipt downloaded.', 'success');
    } catch { toast?.('Could not generate receipt', 'error'); }
  };

  /* ---- Empty state: no finalised rental yet ---- */
  if (!t) {
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
            When you finalise a home you rent through PuneNest, it appears here — with online rent, HRA receipts,
            your agreement and deposit options, all in one place.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
            <Link to="/listings?deal=rent" className="btn-teal px-5 py-2.5 rounded-xl text-white text-sm font-semibold inline-flex items-center gap-2">
              <Icon name="search" className="w-4 h-4" /> Browse rentals
            </Link>
            <button onClick={loadDemo} className="px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 text-sm font-semibold inline-flex items-center gap-2 border border-white/10">
              <Icon name="sparkles" className="w-4 h-4 text-amber-400" /> Load a demo rental
            </button>
          </div>
          <p className="text-gray-600 text-[11px] mt-3">Prototype — the demo rental seeds sample data so you can try every feature.</p>
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
          <img src={t.image} alt={t.title} className="w-full sm:w-52 h-40 sm:h-auto object-cover" />
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

      {/* This-month rent status + Pay CTA */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className={'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ' + (status.paidThisMonth ? 'bg-emerald-500/15' : 'bg-amber-500/15')}>
            <Icon name={status.paidThisMonth ? 'badge-check' : 'calendar-clock'} className={'w-6 h-6 ' + (status.paidThisMonth ? 'text-emerald-300' : 'text-amber-300')} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm">
              {status.paidThisMonth ? `Rent for ${fmtMonthName(status.month)} is paid` : `Rent for ${fmtMonthName(status.month)} is due`}
            </p>
            <p className="text-gray-500 text-xs mt-0.5">
              {status.paidThisMonth ? `Next rent due ${status.nextDueLabel}` : `Due ${status.nextDueLabel} · ${fmtINR(t.rent)}`}
              {mandate ? ' · Autopay on' : ''}
            </p>
          </div>
          {payEnabled ? (
            <Link to={`/pay-rent?prop=${encodeURIComponent(t.propId)}`} className={'px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 ' + (status.paidThisMonth ? 'bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10' : 'btn-teal text-white')}>
              <Icon name="indian-rupee" className="w-4 h-4" /> {status.paidThisMonth ? 'Pay again' : 'Pay rent'}
            </Link>
          ) : (
            <Link to={`/pay-rent?prop=${encodeURIComponent(t.propId)}`} className="px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10">
              <Icon name="calendar-clock" className="w-4 h-4" /> Pay rent · Coming soon
            </Link>
          )}
        </div>
      </Card>

      {/* Quick actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ActionTile to={`/pay-rent?prop=${encodeURIComponent(t.propId)}`} icon="wallet" title="Pay rent" desc="Online · instant HRA receipt" soon={!payEnabled} />
        <ActionTile to="/services/rent-agreement" icon="file-signature" title="Rent agreement" desc={agreement ? 'Registered · view' : 'Create & e-register'} />
        <ActionTile to={`/pay-rent?prop=${encodeURIComponent(t.propId)}`} icon="repeat" title="Autopay" desc={mandate ? 'On · manage' : 'Never miss a due date'} soon={!payEnabled} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Payment history */}
        <Card className="p-6">
          <SectionHead icon="receipt-indian-rupee" title="Rent payments" sub="Every rent paid on PuneNest — download an HRA receipt anytime." action={payEnabled
            ? <Link to={`/pay-rent?prop=${encodeURIComponent(t.propId)}`} className="text-teal-400 text-sm font-medium hover:text-teal-300 whitespace-nowrap">Pay rent →</Link>
            : <Link to={`/pay-rent?prop=${encodeURIComponent(t.propId)}`} className="text-gray-400 hover:text-gray-200 text-xs font-medium whitespace-nowrap inline-flex items-center gap-1"><Icon name="calendar-clock" className="w-3.5 h-3.5" /> Coming soon</Link>} />
          {payments.length ? (
            <div className="space-y-2.5">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/8">
                  <div className="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center flex-shrink-0"><Icon name="wallet" className="w-4.5 h-4.5 text-teal-400" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{fmtMonthName(p.month)} · {p.to || t.ownerName}</p>
                    <p className="text-gray-500 text-xs">{p.method || 'UPI'} · {new Date(p.at).toLocaleDateString('en-IN')} <span className="text-emerald-300">· Owner credited</span></p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-white text-sm font-semibold">{fmtINR(p.amount || 0)}</p>
                    <button onClick={() => downloadReceipt(p)} className="text-[11px] text-teal-300 hover:text-teal-200 inline-flex items-center gap-1 mt-0.5"><Icon name="download" className="w-3 h-3" /> HRA receipt</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm py-6 text-center">No rent paid yet. Your first payment will appear here with an HRA receipt.</p>
          )}
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
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5"><span>Trust score</span><span className="text-white font-semibold">{score}%</span></div>
            <div className="insight-bar"><span style={{ width: `${score}%` }} /></div>
            <p className="text-gray-500 text-xs mt-2.5">A higher score gets you priority with owners. Add your ID, employment and income to boost it.</p>
            <Link to="/dashboard#profile" className="mt-3 inline-flex items-center gap-1.5 text-teal-300 hover:text-teal-200 text-sm font-medium"><Icon name="arrow-right" className="w-4 h-4" /> Complete your profile</Link>
          </Card>

          {showDemoReset && (
            <button onClick={removeDemo} className="w-full text-[12px] text-gray-500 hover:text-rose-300 py-2">Remove demo rental</button>
          )}
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
            <Link to={invitePath(inv.inviteId)} className="btn-teal px-4 py-2.5 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2 flex-shrink-0">
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
      <p className="text-gray-400 text-sm mt-1.5 max-w-2xl">Pay rent online with an instant HRA receipt, keep your agreement and deposit sorted, and stay on top of every due date — all in one place.</p>
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
