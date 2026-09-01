import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import HScroll from '../ui/HScroll.jsx';
import Select from '../ui/Select.jsx';
import { fmtINR } from '../../lib/format.js';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import {
  myRentals, addRental, updateRental, deleteRental,
} from '../../services/rentService.js';
import {
  hraExemption, depositInfo, fyLabel,
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

/* Rent Wallet — the tenant view of Finances.

   Everything on this screen is built from what the tenant *told us* they pay. No rent moves
   through PuneNest, so there is no payment history to read and nothing here is evidence. That is
   not a limitation to work around — it is the whole point: a tenant who found their home through a
   broker, a friend or a noticeboard still gets their yearly total and their HRA arithmetic, which
   is the part that actually saves them money.

   It is also why the Rent Passport is sealed below rather than scored from these figures. That
   document is handed to a prospective landlord under the words "verified rent-payment record";
   generating it from self-reported numbers would make it a forgery with our name on it. */
export default function TenantFinancesTab({ user, toast }) {
  const { t, i18n } = useTranslation();
  const { flagEnabled } = useAppFlags();
  const mob = user?.mobile || '';
  const [idx, setIdx] = useState(0);

  /* One caller-scoped read. `monthsPaid`, `totalPaid` and `fyPaid` arrive computed — the
     April–March financial year is defined on the server so this screen and any export cannot
     drift apart by a month. */
  const [rentals, setRentals] = useState([]);
  const [status, setStatus] = useState('loading');
  const [editing, setEditing] = useState(null);

  /* A read token, bumped on every request and on unmount.

     Three things go wrong without it, and none of them announces itself. A save and its reload
     overlap with a second save, and the responses land in whatever order the network chooses, so a
     stale list overwrites a fresh one — the row you just added disappears, or the one you deleted
     comes back. A reload that resolves after the tab has been switched away sets state on a
     component nobody is looking at. And a reload that FAILS after a success toast would, if it
     were allowed to write, empty the list and flip the screen to "add the home you rent" — telling
     the tenant their save worked and then showing them that it did not.

     So: last request wins, and a failure sets an error state rather than an empty one. The
     distinction between "you have recorded nothing" and "we could not ask" is the whole point —
     a tenant shown the first when the second is true will re-enter a rental they already have. */
  const gen = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++gen.current;
    try {
      const rows = await myRentals();
      if (gen.current !== mine) return;
      setRentals(rows);
      // Keep the selection inside the list rather than letting a shorter list silently fall back
      // to row 0, which would leave Remove pointed at a rental the user did not choose.
      setIdx((i) => Math.min(i, Math.max(0, rows.length - 1)));
      setStatus('ready');
    } catch {
      if (gen.current === mine) setStatus('error');
    }
  }, []);

  useEffect(() => {
    setStatus('loading');
    setIdx(0);
    reload();
    // Bumping the token on the way out cancels anything still in flight for the previous account.
    // Aliased because the lint rule assumes a ref holds a DOM node whose identity goes stale; this
    // one holds a counter, and bumping whatever it holds AT cleanup time is exactly the intent.
    const token = gen;
    return () => { token.current++; };
  }, [user?.mobile, reload]);

  const loaded = status !== 'loading';
  const rental = rentals[idx] || null;
  const deposit = useMemo(() => depositInfo(rental), [rental]);

  // HRA saver inputs (basic salary annual + tax slab). Pune is a non-metro (40%).
  const [basic, setBasic] = useState(() => { try { return localStorage.getItem(basisSalaryKey(mob)) || ''; } catch { return ''; } });
  const [slab, setSlab] = useState('0.2');
  useEffect(() => { try { localStorage.setItem(basisSalaryKey(mob), basic || ''); } catch { /* quota */ } }, [basic, mob]);
  const annualRent = (Number(rental?.monthlyRent) || 0) * 12;
  const hra = useMemo(
    () => hraExemption({ annualRent, annualBasic: Number(basic) || 0, metro: false, slabRate: Number(slab) }),
    [annualRent, basic, slab],
  );

  const onSaved = (msg) => { setEditing(null); reload(); toast?.(msg, 'success'); };
  const onRemove = async (id) => {
    try {
      await deleteRental(id);
      setIdx(0);
      await reload();
      toast?.(t('wallet.rentalRemoved'), 'success');
    } catch { toast?.(t('wallet.rentalFailed'), 'error'); }
  };

  /* The read failed. Deliberately NOT the empty state below: "you have not recorded a rental" is a
     claim about the tenant's account, and making it on the strength of a failed request invites
     them to type in a rental they already have. */
  if (status === 'error' && !editing) {
    return (
      <div className="space-y-6">
        <Hero />
        <Card className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <Icon name="alert-circle" className="w-7 h-7 text-amber-300" />
          </div>
          <h2 className="text-white text-lg font-bold">{t('wallet.loadFailedTitle')}</h2>
          <p className="text-gray-400 text-sm mt-1.5 max-w-md mx-auto">{t('wallet.loadFailedBody')}</p>
          <div className="mt-5">
            <button
              onClick={() => { setStatus('loading'); reload(); }}
              className="btn-teal px-5 py-2.5 rounded-xl text-white text-sm font-semibold inline-flex items-center gap-2"
            >
              <Icon name="refresh-cw" className="w-4 h-4" />
              {t('wallet.retry')}
            </button>
          </div>
        </Card>
      </div>
    );
  }

  /* Empty state — nothing recorded yet. */
  if (loaded && !rental && !editing) {
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
            <button onClick={() => setEditing({})} className="btn-teal px-5 py-2.5 rounded-xl text-white text-sm font-semibold inline-flex items-center gap-2">
              <Icon name="plus" className="w-4 h-4" /> {t('wallet.addRental')}
            </button>
            <Link to="/listings?deal=rent" className="pn-control pn-control--ghost px-4 gap-2">
              <Icon name="search" className="w-4 h-4" /> {t('wallet.browseRentals')}
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-6">
        <Hero />
        <RentalForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onDone={onSaved}
          onError={() => toast?.(t('wallet.rentalFailed'), 'error')}
        />
      </div>
    );
  }

  if (!rental) return <div className="space-y-6"><Hero /></div>;

  const monthlyRent = Number(rental.monthlyRent) || 0;
  // Reverse an EMI (₹868/lakh at 8.5% for 20y) to the home price whose EMI ≈ your rent.
  const buyPrice = monthlyRent ? Math.round((monthlyRent / 868) * 100000) : 0;

  return (
    <div className="space-y-6">
      <Hero />

      <div className="flex items-center gap-2 flex-wrap">
        {rentals.length > 1 && (
          <HScroll wrapClassName="-mx-1 flex-1" className="flex gap-1.5 px-1">
            {rentals.map((x, i) => (
              <button key={x.id} onClick={() => setIdx(i)} className={'inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 text-sm font-medium transition ' + (i === idx ? 'border-brand-teal/30 bg-brand-teal/15 text-brand-teal' : 'border-transparent bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white')}>
                <Icon name="house" className="w-4 h-4" /> {x.address}
              </button>
            ))}
          </HScroll>
        )}
        <button onClick={() => setEditing({})} className="pn-control pn-control--ghost px-3 text-xs gap-1.5">
          <Icon name="plus" className="w-4 h-4" /> {t('wallet.addRental')}
        </button>
      </div>

      {/* The recorded rental itself — stated plainly as the tenant's own entry. */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm truncate">{rental.address}</p>
            <p className="text-gray-500 text-xs mt-0.5">
              {fmtINR(monthlyRent)}/mo
              {rental.landlordName ? ' · ' + rental.landlordName : ''}
              {rental.leaseStart ? ' · ' + t('wallet.since', { date: rental.leaseStart }) : ''}
            </p>
            <p className="text-[11px] text-gray-600 mt-1.5 flex items-center gap-1.5">
              <Icon name="info" className="w-3.5 h-3.5" /> {t('wallet.selfDeclared')}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => setEditing(rental)} className="pn-control pn-control--ghost px-3 text-xs gap-1.5">
              <Icon name="pencil" className="w-4 h-4" /> {t('wallet.edit')}
            </button>
            <button onClick={() => onRemove(rental.id)} className="pn-control pn-control--ghost px-3 text-xs gap-1.5 text-rose-300">
              <Icon name="trash-2" className="w-4 h-4" /> {t('wallet.remove')}
            </button>
          </div>
        </div>
      </Card>

      {/* KPI stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon="receipt-indian-rupee" bg="bg-teal-400/15" fg="text-teal-400" value={fmtINR(rental.fyPaid)} label={t('wallet.rentPaidFy', { fy: fyLabel() })} />
        <Stat icon="wallet" bg="bg-emerald-400/15" fg="text-emerald-400" value={fmtINR(rental.totalPaid)} label={t('wallet.lifetime')} hint={t('wallet.monthsPaid', { count: rental.monthsPaid })} />
        <Stat icon="landmark" bg="bg-amber-400/15" fg="text-amber-400" value={deposit.deposit ? fmtINR(deposit.deposit) : '—'} label={t('wallet.depositLocked')} hint={deposit.deposit ? t('wallet.monthsHeld', { count: deposit.monthsLocked }) : undefined} />
        <Stat icon="piggy-bank" bg="bg-brand-teal/15" fg="text-brand-teal-3" value={hra.taxSaved ? fmtINR(hra.taxSaved) : '—'} label={t('wallet.hraSaved')} hint={hra.taxSaved ? t('wallet.thisYear') : t('wallet.addSalaryBelow')} />
      </div>

      {/* Rent Passport — sealed until rent moves through the platform.

          Deliberately not scored from the figures above. The PDF this button used to produce is
          headed "Verified rent-payment record" and is handed to a prospective landlord; built from
          numbers the tenant typed, it would be a document asserting something we cannot know. */}
      <Card className="p-6">
        <SectionHead
          icon="shield-check"
          iconCls="text-gray-500"
          title={t('wallet.passportTitle')}
          sub={t('wallet.passportSoonSub')}
          action={(
            <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg bg-amber-400/15 text-amber-300 font-semibold">
              <Icon name="calendar-clock" className="w-3.5 h-3.5" /> {t('wallet.comingSoon')}
            </span>
          )}
        />
        <p className="text-gray-400 text-sm">{t('wallet.passportSoonBody')}</p>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* HRA Tax Saver */}
        <Card className="p-6">
          <SectionHead icon="piggy-bank" iconCls="text-brand-teal-3" title={t('wallet.hraTitle')} sub={t('wallet.hraSub')} />
          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className="text-sm"><span className="mb-1.5 block text-gray-400">{t('wallet.annualBasic')}</span>
              <input type="number" inputMode="numeric" value={basic} onChange={(e) => setBasic(e.target.value)} placeholder="₹" className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" />
            </label>
            {/* A div, not a label: Select renders a <button>, and a wrapping label does not give a
                button its accessible name — name-from-content wins, so a screen reader would
                announce the chosen value ("20%") with nothing to say what it is a slab of. */}
            <div className="text-sm"><span className="mb-1.5 block text-gray-400">{t('wallet.taxSlab')}</span>
              <Select ariaLabel={t('wallet.taxSlab')} value={slab} onChange={setSlab} options={[{ value: '0.05', label: '5%' }, { value: '0.1', label: '10%' }, { value: '0.2', label: '20%' }, { value: '0.3', label: '30%' }]} className="w-full" />
            </div>
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

const Row = ({ label, value, valueCls = 'text-white', big }) => (
  <div className="flex items-center justify-between gap-3">
    <span className={'text-gray-400 ' + (big ? 'text-sm' : 'text-sm')}>{label}</span>
    <span className={(big ? 'text-lg ' : 'text-sm ') + 'font-semibold ' + valueCls}>{value}</span>
  </div>
);

const Field = ({ label, hint, children }) => (
  <label className="text-sm block">
    <span className="mb-1.5 block text-gray-400">{label}</span>
    {children}
    {hint ? <span className="mt-1 block text-[11px] text-gray-600">{hint}</span> : null}
  </label>
);

const input = 'field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm';

/**
 * Record or edit a home the tenant already rents.
 *
 * Only the address, the rent and the start date are required, because that trio is the whole of
 * what the totals and the HRA figure need. Asking for a deposit or an end date the tenant does not
 * have to hand would trade a real feature for a blank form.
 *
 * The patch sends the whole form, not a diff. That is safe only because every field is seeded from
 * `initial` above, so an untouched input round-trips its existing value — and it stops being safe
 * the moment a field is added that is not seeded that way, because a blank optional input is sent
 * as a real clear. Seed any new field here, or start diffing against `initial`.
 */
function RentalForm({ initial, onCancel, onDone, onError }) {
  const { t } = useTranslation();
  const editingExisting = !!initial?.id;
  const [form, setForm] = useState({
    address: initial?.address || '',
    landlordName: initial?.landlordName || '',
    monthlyRent: initial?.monthlyRent ? String(initial.monthlyRent) : '',
    deposit: initial?.deposit == null ? '' : String(initial.deposit),
    leaseStart: initial?.leaseStart || '',
    leaseEnd: initial?.leaseEnd || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const complete = form.address.trim() && Number(form.monthlyRent) > 0 && form.leaseStart;
  const datesOrdered = !form.leaseEnd || !form.leaseStart || form.leaseEnd >= form.leaseStart;

  const submit = async (e) => {
    e.preventDefault();
    if (!complete || !datesOrdered || busy) return;
    setBusy(true);
    try {
      if (editingExisting) {
        await updateRental(initial.id, form);
        onDone(t('wallet.rentalUpdated'));
      } else {
        await addRental(form);
        onDone(t('wallet.rentalAdded'));
      }
    } catch { onError(); } finally { setBusy(false); }
  };

  return (
    <Card className="p-6">
      <SectionHead
        icon="house"
        title={editingExisting ? t('wallet.editRental') : t('wallet.addRental')}
        sub={t('wallet.formSub')}
      />
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('wallet.formAddress')}>
          <input value={form.address} onChange={set('address')} maxLength={300} required className={input} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('wallet.formRent')}>
            <input type="number" inputMode="numeric" min="1" value={form.monthlyRent} onChange={set('monthlyRent')} required className={input} />
          </Field>
          <Field label={t('wallet.formDeposit')} hint={t('wallet.optional')}>
            <input type="number" inputMode="numeric" min="0" value={form.deposit} onChange={set('deposit')} className={input} />
          </Field>
          <Field label={t('wallet.formStart')}>
            <input type="date" value={form.leaseStart} onChange={set('leaseStart')} required className={input} />
          </Field>
          <Field label={t('wallet.formEnd')} hint={t('wallet.optional')}>
            <input
              type="date"
              value={form.leaseEnd}
              onChange={set('leaseEnd')}
              aria-invalid={!datesOrdered}
              aria-describedby={datesOrdered ? undefined : 'rental-dates-error'}
              className={input}
            />
          </Field>
        </div>
        <Field label={t('wallet.formLandlord')} hint={t('wallet.optional')}>
          <input value={form.landlordName} onChange={set('landlordName')} maxLength={120} className={input} />
        </Field>
        {!datesOrdered && (
          <p id="rental-dates-error" role="alert" className="flex items-center gap-1.5 text-rose-300 text-xs">
            <Icon name="alert-circle" className="w-3.5 h-3.5 shrink-0" />
            {t('wallet.formDatesInvalid')}
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={!complete || !datesOrdered || busy} className="btn-teal px-5 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50">
            {t('wallet.save')}
          </button>
          <button type="button" onClick={onCancel} className="pn-control pn-control--ghost px-4">{t('wallet.cancel')}</button>
        </div>
      </form>
    </Card>
  );
}
