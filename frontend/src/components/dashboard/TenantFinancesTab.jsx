import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import HScroll from '../ui/HScroll.jsx';
import Select from '../ui/Select.jsx';
import { fmtINR } from '../../lib/format.js';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import {
  toRentalCard,
} from '../../lib/data/tenancy.js';
import {
  myTenancies, myRentPayments, myTenantProfile, myRentAgreements,
} from '../../services/rentService.js';
import { MAX_PAGE_SIZE } from '../../services/apiLimits.js';
import {
  rentSummary, hraExemption, depositInfo, rentPassport,
  downloadRentReport, fyLabel,
} from '../../lib/data/tenantFinance.js';

const Card = ({ children, className = '' }) => (
  <div className={'glass-card rounded-2xl ' + className}>{children}</div>
);

function Stat({ icon, bg, fg, value, label, hint }) {
  return (
    <Card className="p-5">
      <div className={'w-10 h-10 rounded-xl flex items-center justify-center mb-3 ' + bg}>
        <Icon name={icon} className={'w-5 h-5 ' + fg} />
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-gray-500 text-xs mt-0.5">{label}</p>
      {hint ? <p className="text-[11px] text-gray-600 mt-1">{hint}</p> : null}
    </Card>
  );
}

const SectionHead = ({ icon, iconCls = 'text-teal-400', title, sub, action }) => (
  <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
    <div>
      <h2 className="text-lg font-bold text-white flex items-center gap-2">
        {icon ? <Icon name={icon} className={'w-5 h-5 ' + iconCls} /> : null} {title}
      </h2>
      {sub ? <p className="text-gray-500 text-xs mt-0.5">{sub}</p> : null}
    </div>
    {action}
  </div>
);

/* Persist the tenant's basic-salary input so the HRA saver stays populated across
   visits (a small stickiness touch; no PII leaves the device). */
const basisSalaryKey = (mob) => 'pnHraBasic:' + (mob || 'anon');

/* Rent Wallet — the tenant view of Finances. Turns rent into tax saved and a
   portable "Rent Passport" credential (the retention differentiator). */
export default function TenantFinancesTab({ user, toast }) {
  const { t, i18n } = useTranslation();
  const { flagEnabled } = useAppFlags();
  const mob = user?.mobile || '';
  const [idx, setIdx] = useState(0);

  /* The tenant's rental, their rent history, their profile and their agreements. Four caller-scoped
     reads issued together: none depends on another, and every number on this page is derived from
     all four, so there is nothing useful to render until they all land. */
  const [wallet, setWallet] = useState({ tenancies: [], payments: [], profile: null, agreements: [] });
  useEffect(() => {
    let alive = true;
    Promise.all([
      myTenancies().catch(() => []),
      // The wallet totals lifetime rent, so it needs the whole history rather than the first page.
      myRentPayments(0, MAX_PAGE_SIZE).catch(() => ({ items: [] })),
      myTenantProfile().catch(() => null),
      myRentAgreements().catch(() => []),
    ]).then(([rows, page, profileRow, agreementRows]) => {
      if (!alive) return;
      setWallet({
        tenancies: (rows || []).map((row) => toRentalCard(row)),
        payments: page?.items || [],
        profile: profileRow,
        agreements: agreementRows || [],
      });
    });
    return () => { alive = false; };
  }, [user]);

  const tenancies = wallet.tenancies;
  const tenancy = tenancies[idx] || tenancies[0] || null;
  const payments = wallet.payments;
  const summary = useMemo(() => rentSummary(payments), [payments]);
  const agreement = wallet.agreements[0] || null;
  const profile = wallet.profile;
  const deposit = useMemo(() => depositInfo(tenancy), [tenancy]);
  const passport = useMemo(
    () => rentPassport({ payments, tenancy, agreement, profile, user }),
    [payments, tenancy, agreement, profile, user],
  );

  // HRA saver inputs (basic salary annual + tax slab). Pune is a non-metro (40%).
  const [basic, setBasic] = useState(() => { try { return localStorage.getItem(basisSalaryKey(mob)) || ''; } catch { return ''; } });
  const [slab, setSlab] = useState('0.2');
  useEffect(() => { try { localStorage.setItem(basisSalaryKey(mob), basic || ''); } catch { /* quota */ } }, [basic, mob]);
  const annualRent = (Number(tenancy?.rent) || 0) * 12;
  const hra = useMemo(
    () => hraExemption({ annualRent, annualBasic: Number(basic) || 0, metro: false, slabRate: Number(slab) }),
    [annualRent, basic, slab],
  );

  const doReport = () => {
    if (!passport.onTime) { toast?.(t('wallet.buildPassport'), 'info'); return; }
    downloadRentReport(passport, payments)
      ? toast?.(t('wallet.reportDownloaded'), 'success')
      : toast?.(t('wallet.reportFailed'), 'error');
  };

  /* Empty state — no finalised rental yet. */
  if (!tenancy) {
    return (
      <div className="space-y-6">
        <Hero />
        <Card className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-brand-teal/10 flex items-center justify-center mx-auto mb-4">
            <Icon name="wallet" className="w-7 h-7 text-brand-teal-3" />
          </div>
          <h2 className="text-white text-lg font-bold">{t('wallet.emptyTitle')}</h2>
          <p className="text-gray-400 text-sm mt-1.5 max-w-md mx-auto">
            <Trans i18nKey="wallet.emptyBody" components={{ 1: <span className="text-brand-teal-3 font-medium" /> }} />
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
            <Link to="/listings?deal=rent" className="btn-teal px-5 py-2.5 rounded-xl text-white text-sm font-semibold inline-flex items-center gap-2">
              <Icon name="search" className="w-4 h-4" /> {t('wallet.browseRentals')}
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const monthlyRent = Number(tenancy.rent) || 0;
  // Reverse an EMI (₹868/lakh at 8.5% for 20y) to the home price whose EMI ≈ your rent.
  const buyPrice = monthlyRent ? Math.round((monthlyRent / 868) * 100000) : 0;

  return (
    <div className="space-y-6">
      <Hero />

      {tenancies.length > 1 && (
        <HScroll wrapClassName="-mx-1" className="flex gap-1.5 px-1">
          {tenancies.map((x, i) => (
            <button key={x.id} onClick={() => setIdx(i)} className={'inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 text-sm font-medium transition ' + (i === idx ? 'border-brand-teal/30 bg-brand-teal/15 text-brand-teal' : 'border-transparent bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white')}>
              <Icon name="house" className="w-4 h-4" /> {x.locality || x.title}
            </button>
          ))}
        </HScroll>
      )}

      {/* KPI stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon="receipt-indian-rupee" bg="bg-teal-400/15" fg="text-teal-400" value={fmtINR(summary.fyPaid)} label={t('wallet.rentPaidFy', { fy: fyLabel() })} />
        <Stat icon="wallet" bg="bg-emerald-400/15" fg="text-emerald-400" value={fmtINR(summary.lifetime)} label={t('wallet.lifetime')} hint={t('wallet.monthsPaid', { count: summary.monthsPaid })} />
        <Stat icon="landmark" bg="bg-amber-400/15" fg="text-amber-400" value={deposit.deposit ? fmtINR(deposit.deposit) : '—'} label={t('wallet.depositLocked')} hint={deposit.deposit ? t('wallet.monthsHeld', { count: deposit.monthsLocked }) : undefined} />
        <Stat icon="piggy-bank" bg="bg-brand-teal/15" fg="text-brand-teal-3" value={hra.taxSaved ? fmtINR(hra.taxSaved) : '—'} label={t('wallet.hraSaved')} hint={hra.taxSaved ? t('wallet.thisYear') : t('wallet.addSalaryBelow')} />
      </div>

      {/* Rent Passport — the differentiator */}
      <Card className="p-6">
        <SectionHead
          icon="shield-check"
          title={t('wallet.passportTitle')}
          sub={t('wallet.passportSub')}
          action={(
            <button onClick={doReport} className="pn-control pn-control--action px-4 gap-2">
              <Icon name="download" className="w-4 h-4" /> {t('wallet.downloadReport')}
            </button>
          )}
        />
        <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-6 items-center">
          <div className="text-center sm:text-left">
            <div className="inline-flex items-baseline gap-1">
              <span className="text-5xl font-extrabold text-white">{passport.score}</span>
              <span className="text-gray-500 text-lg font-semibold">/100</span>
            </div>
            <p className="text-brand-teal-3 text-sm font-semibold mt-1 flex items-center gap-1.5 justify-center sm:justify-start">
              <Icon name="badge-check" className="w-4 h-4" /> {passport.score >= 80 ? t('wallet.tenantExcellent') : passport.score >= 50 ? t('wallet.tenantReliable') : t('wallet.tenantBuilding')}
            </p>
            <div className="insight-bar mt-3"><span style={{ width: `${passport.score}%` }} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <PassBadge on={passport.onTime > 0} icon="calendar-check" label={t('wallet.onTime', { count: passport.onTime })} />
            <PassBadge on={passport.registered} icon="file-signature" label={passport.registered ? t('wallet.agreementRegistered') : t('wallet.agreementNone')} />
            <PassBadge on={passport.verified} icon="badge-check" label={passport.verified ? t('wallet.idVerified') : t('wallet.idNotVerified')} />
            <PassBadge on={!!passport.since} icon="clock" label={passport.since ? t('wallet.rentingSince', { month: fmtMonth(passport.since, i18n.language) }) : t('wallet.newHere')} />
          </div>
        </div>
        <p className="text-gray-600 text-[11px] mt-4 flex items-center gap-1.5">
          <Icon name="info" className="w-3.5 h-3.5" /> {t('wallet.passportNote')}
        </p>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* HRA Tax Saver */}
        <Card className="p-6">
          <SectionHead icon="piggy-bank" iconCls="text-brand-teal-3" title={t('wallet.hraTitle')} sub={t('wallet.hraSub')} />
          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className="text-sm"><span className="mb-1.5 block text-gray-400">{t('wallet.annualBasic')}</span>
              <input type="number" inputMode="numeric" value={basic} onChange={(e) => setBasic(e.target.value)} placeholder="₹" className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" />
            </label>
            <label className="text-sm"><span className="mb-1.5 block text-gray-400">{t('wallet.taxSlab')}</span>
              <Select value={slab} onChange={setSlab} options={[{ value: '0.05', label: '5%' }, { value: '0.1', label: '10%' }, { value: '0.2', label: '20%' }, { value: '0.3', label: '30%' }]} className="w-full" />
            </label>
          </div>
          {Number(basic) > 0 ? (
            <div className="space-y-2.5 p-4 rounded-xl bg-brand-teal-1/5 border border-brand-teal-2/20">
              <Row label={t('wallet.rentPaidRow', { rent: fmtINR(monthlyRent) })} value={fmtINR(annualRent)} />
              <Row label={t('wallet.hraExemption')} value={fmtINR(hra.exemption)} valueCls="text-brand-teal-3" />
              <div className="h-px bg-white/10 my-1" />
              <Row label={t('wallet.estTaxSaved')} value={fmtINR(hra.taxSaved)} valueCls="text-emerald-300 font-bold" big />
              <p className="text-[11px] text-gray-600 pt-1">{t('wallet.hraNote')}</p>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">{t('wallet.addSalaryPrompt')}</p>
          )}
        </Card>

        {/* Deposit tracker */}
        <Card className="p-6">
          <SectionHead icon="landmark" iconCls="text-amber-400" title={t('wallet.depositTitle')} sub={t('wallet.depositSub')} />
          {deposit.deposit ? (
            <div className="space-y-2.5">
              <Row label={t('wallet.depositPaid')} value={fmtINR(deposit.deposit)} />
              <Row label={t('wallet.heldFor')} value={t('wallet.monthsPaid', { count: deposit.monthsLocked })} />
              <Row label={t('wallet.expectedRefund')} value={deposit.refundDate ? deposit.refundDate.toLocaleDateString(i18n.language, { month: 'short', year: 'numeric' }) : t('wallet.atLeaseEnd')} />
              <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5">
                <Icon name="trending-up" className="w-4 h-4 text-amber-300 mt-0.5 flex-shrink-0" />
                <p className="text-amber-100/90 text-xs"><Trans i18nKey="wallet.depositForegone" values={{ amount: fmtINR(deposit.foregoneAnnual) }} components={{ 1: <span className="font-semibold text-amber-200" /> }} /></p>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">{t('wallet.noDeposit')}</p>
          )}
        </Card>
      </div>

      {/* Rent vs Buy nudge */}
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-teal-400/15 flex items-center justify-center flex-shrink-0">
            <Icon name="scale" className="w-6 h-6 text-teal-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-base">{t('wallet.emiTitle')}</h2>
            <p className="text-gray-400 text-sm mt-0.5">
              <Trans i18nKey="wallet.emiBody" values={{ rent: fmtINR(monthlyRent), price: fmtINR(buyPrice) }} components={{ 1: <span className="text-teal-300 font-semibold" /> }} />
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {flagEnabled('emiCalculator') && (
              <Link to="/emi-calculator" className="pn-control pn-control--ghost px-3 text-xs gap-1.5"><Icon name="calculator" className="w-4 h-4" /> {t('wallet.emiCalc')}</Link>
            )}
            <Link to="/listings?deal=buy" className="pn-control pn-control--action px-4 gap-1.5"><Icon name="home" className="w-4 h-4" /> {t('wallet.homesToBuy')}</Link>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Hero() {
  const { t } = useTranslation();
  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-teal-1/15 border border-brand-teal-2/25 text-brand-teal-3 text-xs font-medium"><Icon name="wallet" className="w-3.5 h-3.5" /> {t('wallet.forTenants')}</span>
      </div>
      <h1 className="text-xl sm:text-2xl font-bold text-white">{t('wallet.title')}</h1>
      <p className="text-gray-400 text-sm mt-1.5 max-w-2xl">{t('wallet.intro')}</p>
    </div>
  );
}

const PassBadge = ({ on, icon, label }) => (
  <div className={'flex items-center gap-2.5 p-3 rounded-xl border ' + (on ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/[0.03] border-white/8')}>
    <Icon name={icon} className={'w-4 h-4 flex-shrink-0 ' + (on ? 'text-emerald-300' : 'text-gray-600')} />
    <span className={'text-xs ' + (on ? 'text-emerald-100/90' : 'text-gray-500')}>{label}</span>
  </div>
);

const Row = ({ label, value, valueCls = 'text-white', big }) => (
  <div className="flex items-center justify-between gap-3">
    <span className={'text-gray-400 ' + (big ? 'text-sm' : 'text-sm')}>{label}</span>
    <span className={(big ? 'text-lg ' : 'text-sm ') + 'font-semibold ' + valueCls}>{value}</span>
  </div>
);

/* `YYYY-MM` → "Mon YYYY", in the reader's language. */
function fmtMonth(s, locale = 'en') {
  const [y, m] = String(s || '').split('-');
  if (!y) return s || '';
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(locale, { month: 'short', year: 'numeric' });
}
