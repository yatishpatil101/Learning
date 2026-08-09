/**
 * Mock rent provider — the localStorage counterpart to `providers/http/rentProvider.js`.
 *
 * ## What this tightens, and why every one of them had to move
 *
 * This domain handles money, so a mock more permissive than the server is not a testing
 * inconvenience — it is a call site written against a promise the real thing will break, in the one
 * area where breaking it costs somebody rupees.
 *
 * | Rule | Mock before | Here (and on the server) |
 * |---|---|---|
 * | Paying rent | recorded `status: 'paid'` at once | `due` against a gateway order; only the webhook settles it |
 * | Paying twice in a month | stacked a second row | 409 |
 * | Paying a stale amount | charged whatever was passed | 409 if it disagrees with the tenancy's rent |
 * | Reading a payout account | returned the full account number | a mask, never the number |
 * | Owner/tenant scoping | any caller could name any mobile | the signed-in caller only |
 *
 * The last one is the same hole the deal slice had: `getRentLedger(ownerMobile)` and
 * `getPayoutAccount(mobile)` both took *whose data to read* as an argument.
 */
import { ApiError } from '../../http.js';
import { readUser } from '../../../lib/auth.js';
import { digits, myMobile } from '../../../lib/contact.js';
import {
  getFees,
  getRentPayments,
  addRentPayment as _storeAddPayment,
  getRentLedger,
  getRentMandate as _storeGetMandate,
  setRentMandate as _storeSetMandate,
  getPayoutAccount as _storeGetPayout,
  savePayoutAccount as _storeSavePayout,
  getTenanciesFor,
  getTenantProfile as _storeGetProfile,
  saveTenantProfile as _storeSaveProfile,
  getTenantProfileFor,
  tenantScore,
} from '../../../lib/store.js';
import {
  getBasis as _finGetBasis,
  setBasis as _finSetBasis,
  getTransactions as _finGetTxns,
  addTransaction as _finAddTxn,
  updateTransaction as _finUpdateTxn,
  deleteTransaction as _finDeleteTxn,
  financeSummary as _finSummary,
  cashflowByMonth as _finCashflow,
  getDues as _finDues,
} from '../../../lib/data/finances.js';
import { quoteRentFee } from '../http/rentMapper.js';

/** The signed-in caller's mobile — the mock's stand-in for the bearer token's subject. */
const me = () => digits(myMobile() || '');

/* `ApiError` takes an options **object** (`{ code, message, status, ... }`), not positional
   arguments. Constructing it positionally leaves `status` undefined, so every `err.status === 409`
   branch at a call site silently falls through to the generic path. */
const conflict = (message) => new ApiError({ code: 'conflict', status: 409, message });
const notFound = (what) => new ApiError({ code: 'not_found', status: 404, message: `${what} not found` });
const unauthorized = () => new ApiError({ code: 'unauthorized', status: 401, message: 'Sign in to continue' });
const badRequest = (message) => new ApiError({ code: 'bad_request', status: 400, message });

const requireUser = () => { if (!readUser()) throw unauthorized(); };

/** The page envelope every paged read answers with — `page`, per `PageEnvelope`, never `number`. */
function paginate(rows, page = 0, size = 20) {
  const all = rows || [];
  const start = page * size;
  return {
    items: all.slice(start, start + size),
    page,
    size,
    total: all.length,
    totalPages: Math.max(1, Math.ceil(all.length / size)),
  };
}

/* ─── Tenancies ─────────────────────────────────────────────────────────────────────────────── */

const tenancyVm = (t, { asTenant }) => ({
  id: t.id || `tn-${t.propId || ''}`,
  propId: String(t.propId || ''),
  propertyId: String(t.propId || ''),
  rent: Number(t.rent) || 0,
  deposit: Number(t.deposit) || 0,
  startDate: t.startDate || null,
  endDate: t.endDate || null,
  status: t.status || 'active',
  active: (t.status || 'active') === 'active',
  tenantId: '',
  tenantName: asTenant ? (readUser()?.name || '') : (t.tenantName || ''),
  tenantMobile: asTenant ? me() : digits(t.tenantMobile || ''),
  ownerId: '',
  ownerName: t.ownerName || '',
  ownerMobile: digits(t.ownerMobile || ''),
});

/** Tenancies where the caller is the tenant. Scoped to the caller, as `/me/tenancies` is. */
export async function myTenancies() {
  const mine = me();
  if (!mine) return [];
  return (getTenanciesFor(mine) || []).map((t) => tenancyVm(t, { asTenant: true }));
}

/**
 * Tenancies on the caller's own listings.
 *
 * The store keys tenancies by the **tenant's** mobile, so the owner's view has to be reconstructed
 * by finding rows whose `ownerMobile` is the caller. The server has one table and two queries over
 * it; this is the same idea against a store that was only ever designed for one direction.
 */
export async function ownerTenancies() {
  const mine = me();
  if (!mine) return [];
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('pnTenancies:')) continue;
      const rows = JSON.parse(localStorage.getItem(k)) || [];
      const tenantMobile = k.slice('pnTenancies:'.length);
      rows.forEach((t) => {
        if (digits(t.ownerMobile) === mine) {
          out.push(tenancyVm({ ...t, tenantMobile }, { asTenant: false }));
        }
      });
    }
  } catch { /* an unreadable store just means an empty owner view */ }
  return out;
}

const profileVm = (p, mobile) => {
  if (!p) return null;
  return {
    mobile: digits(mobile || p.mobile || ''),
    name: p.name || '',
    occupation: p.occupation || '',
    income: p.income == null ? null : Number(p.income),
    occupants: p.occupants || '',
    moveIn: p.moveIn || null,
    priorLandlord: p.priorLandlord || '',
    about: p.about || '',
    // The server owns the score. The mock computes the same number rather than inventing a second
    // scale, so a component reading `score` gets a comparable value in both modes.
    score: tenantScore(p),
    verified: !!p.idVerified,
  };
};

export async function myTenantProfile() {
  const mine = me();
  if (!mine) return null;
  return profileVm(_storeGetProfile(), mine);
}

export async function saveTenantProfile(profile = {}) {
  requireUser();
  // `score` and `verified` are server-owned: a client that could set either would be marking its
  // own homework. Stripped here so the mock cannot accept what the server would ignore.
  const writable = { ...profile };
  delete writable.score;
  delete writable.verified;
  delete writable.idVerified;
  _storeSaveProfile(writable);
  return profileVm(_storeGetProfile(), me());
}

export async function tenantProfileFor(mobile) {
  const d = digits(mobile || '');
  if (!me() || d.length !== 10) return null;
  return profileVm(getTenantProfileFor(d), d);
}

/* ─── Rent ──────────────────────────────────────────────────────────────────────────────────── */

const paymentVm = (p) => {
  const amount = Number(p.amount) || 0;
  const platformFee = Number(p.platformFee ?? p.fee) || 0;
  const gst = Number(p.gst) || 0;
  const status = p.status || 'due';
  return {
    id: p.id,
    tenancyId: String(p.tenancyId || ''),
    amount,
    platformFee,
    gst,
    total: amount + platformFee + gst,
    dueDate: p.dueDate || null,
    paidDate: p.paidDate || null,
    status,
    settled: status === 'paid',
    method: p.method || '',
    reference: p.reference || '',
    failureReason: p.failureReason || '',
  };
};

export async function myRentPayments(page = 0, size = 20) {
  if (!me()) return paginate([], page, size);
  return paginate((getRentPayments() || []).map(paymentVm), page, size);
}

export async function rentLedger(page = 0, size = 20) {
  const mine = me();
  if (!mine) return paginate([], page, size);
  return paginate((getRentLedger(mine) || []).map(paymentVm), page, size);
}

/**
 * Pay this month's rent.
 *
 * Returns the payment **`due`**, not `paid`. The mock used to settle instantly because a
 * localStorage write cannot fail; against the server it is an order awaiting a webhook, and a call
 * site written against instant settlement tells a tenant their rent is in when it is not.
 *
 * Both 409s the server raises are raised here, for the same reasons:
 *   - **already paid this month** — the partial unique index on `(tenancy, due_date)` exists so two
 *     taps cannot become two charges;
 *   - **stale amount** — `expectedAmount` is the figure the tenant was *shown*. If the rent has
 *     moved since, charging the old number silently is worse than making them look again.
 */
export async function payRent({ tenancyId, expectedAmount, method = 'upi' } = {}) {
  requireUser();
  if (!tenancyId) throw badRequest('tenancyId is required');
  const tenancy = (getTenanciesFor(me()) || []).find((t) => String(t.id || `tn-${t.propId}`) === String(tenancyId));
  const rent = Number(tenancy?.rent) || 0;
  if (rent <= 0) {
    throw conflict('This tenancy has no rent on record; ask the owner to set it before paying');
  }
  if (expectedAmount != null && Number(expectedAmount) !== rent) {
    throw conflict(`Rent is now ${rent}; refresh and confirm the new amount before paying`);
  }
  const dueDate = new Date().toISOString().slice(0, 8) + '01';
  const live = (getRentPayments() || []).find(
    (p) => String(p.tenancyId) === String(tenancyId) && p.dueDate === dueDate
      && (p.status === 'due' || p.status === 'paid'),
  );
  if (live) throw conflict('Rent for this month is already paid or in progress');

  const fees = getFees();
  const brk = quoteRentFee(rent, { rentPayPercent: fees.rentPayPercent, gstPercent: fees.gstPercent });
  const rec = _storeAddPayment({
    tenancyId: String(tenancyId),
    amount: brk.amount,
    platformFee: brk.fee,
    gst: brk.gst,
    dueDate,
    method,
    // The mock's stand-in for the gateway order id. `reference` is how the webhook finds the row
    // again, so a payment without one could never be settled.
    reference: `mock-order-${Date.now()}`,
    // Overrides the store's `status: 'paid'` default. This is the whole point.
    status: 'due',
  });
  return paymentVm(rec);
}

/**
 * The local stand-in for the payment webhook.
 *
 * **Mock-only, and deliberately so.** An http counterpart would be a client that can mark its own
 * rent paid. The parity harness excludes it by name for the same reason `mockActivateSubscription`
 * is excluded from the plan harness.
 */
export function mockSettleRentPayment(paymentId) {
  const arr = getRentPayments() || [];
  const row = arr.find((p) => p.id === paymentId);
  if (!row) return null;
  row.status = 'paid';
  row.paidDate = new Date().toISOString().slice(0, 10);
  try {
    localStorage.setItem('pnRentPayments:' + (me() || 'anon'), JSON.stringify(arr));
  } catch { /* a full quota just means the settlement is not persisted */ }
  return paymentVm(row);
}

const mandateVm = (m) => {
  if (!m || !m.tenancyId) return null;
  return {
    id: m.id || 'mandate-local',
    tenancyId: String(m.tenancyId),
    maxAmount: Number(m.maxAmount) || 0,
    dayOfMonth: m.dayOfMonth == null ? null : Number(m.dayOfMonth),
    status: m.status || 'active',
    active: (m.status || 'active') === 'active',
    provider: m.provider || 'mock',
  };
};

export async function getMandate() {
  if (!me()) return null;
  return mandateVm(_storeGetMandate());
}

export async function setMandate({ tenancyId, maxAmount, dayOfMonth, status } = {}) {
  requireUser();
  if (!tenancyId) throw badRequest('tenancyId is required');
  // The contract caps the day at 28 — no month has fewer days, so a mandate on the 30th would skip
  // February every year. Enforced here so the mock cannot accept what the server rejects.
  const day = dayOfMonth == null ? null : Number(dayOfMonth);
  if (day != null && (day < 1 || day > 28)) throw badRequest('dayOfMonth must be between 1 and 28');
  _storeSetMandate({
    id: 'mandate-local',
    tenancyId: String(tenancyId),
    maxAmount: Number(maxAmount) || 0,
    dayOfMonth: day,
    status: status || 'active',
    provider: 'mock',
  });
  return mandateVm(_storeGetMandate());
}

/**
 * The owner's payout account.
 *
 * **Returns a mask, never the number.** The store keeps the full `accountNumber` (it has to, to
 * mask it), and the mock used to hand it straight back. The server will not re-serve a bank account
 * number to anyone including its owner, so neither does this.
 */
export async function getPayoutAccount() {
  const mine = me();
  if (!mine) return { accountHolder: '', maskedAccount: '', ifsc: '', upiId: '', verified: false, configured: false };
  const a = _storeGetPayout(mine);
  const num = String(a?.accountNumber || '');
  const masked = num ? `••••${num.slice(-4)}` : (a?.maskedAccount || '');
  const upi = a?.upiId || a?.vpa || '';
  return {
    accountHolder: a?.accountHolder || a?.name || '',
    maskedAccount: masked,
    ifsc: a?.ifsc || '',
    upiId: upi,
    verified: !!a?.verified,
    configured: !!(masked || upi),
  };
}

export async function savePayoutAccount(acc = {}) {
  requireUser();
  const num = acc.accountNumber ? String(acc.accountNumber).replace(/\D/g, '') : '';
  if (num && (num.length < 9 || num.length > 18)) throw badRequest('accountNumber must be 9-18 digits');
  const ifsc = acc.ifsc ? String(acc.ifsc).toUpperCase().trim() : '';
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
    throw badRequest('ifsc must be a valid IFSC, e.g. HDFC0001234');
  }
  _storeSavePayout({
    accountHolder: acc.accountHolder || '',
    accountNumber: num,
    ifsc,
    upiId: acc.upiId || '',
  }, me());
  return getPayoutAccount();
}

/* ─── Property finances ─────────────────────────────────────────────────────────────────────── */

/**
 * The store calls the repeat interval `repeat`; the wire calls it `recurring`. One name wins at the
 * seam (the wire's), and the translation lives here rather than in every call site.
 */
const txnVm = (t, propId) => ({
  id: t.id,
  propId: String(propId || ''),
  propertyId: String(propId || ''),
  type: t.type || 'expense',
  category: t.category || '',
  amount: Number(t.amount) || 0,
  date: t.date || null,
  note: t.note || '',
  recurring: t.recurring || t.repeat || '',
});

export async function listTransactions(propId, page = 0, size = 50) {
  const mine = me();
  if (!mine || !propId) return paginate([], page, size);
  return paginate((_finGetTxns(mine, propId) || []).map((t) => txnVm(t, propId)), page, size);
}

export async function addTransaction(propId, txn = {}) {
  requireUser();
  if (!(Number(txn.amount) > 0)) throw badRequest('amount must be positive');
  const rec = _finAddTxn(me(), propId, {
    type: txn.type || 'expense',
    category: txn.category,
    amount: Number(txn.amount) || 0,
    date: txn.date,
    repeat: txn.recurring || '',
    note: txn.note || '',
  });
  return txnVm(rec, propId);
}

export async function updateTransaction(propId, txnId, patchBody = {}) {
  requireUser();
  const body = { ...patchBody };
  if (body.recurring !== undefined) { body.repeat = body.recurring; delete body.recurring; }
  const rec = _finUpdateTxn(me(), propId, txnId, body);
  if (!rec) throw notFound('Transaction');
  return txnVm(rec, propId);
}

export async function deleteTransaction(propId, txnId) {
  requireUser();
  _finDeleteTxn(me(), propId, txnId);
}

export async function getBasis(propId) {
  const mine = me();
  if (!mine || !propId) return null;
  const b = _finGetBasis(mine, propId);
  if (!b) return null;
  return {
    purchasePrice: b.purchasePrice == null ? null : Number(b.purchasePrice),
    purchaseDate: b.purchaseDate || null,
    loanOutstanding: b.loanOutstanding == null ? null : Number(b.loanOutstanding),
    emi: b.emi == null ? null : Number(b.emi),
    currentValue: b.currentValue == null ? null : Number(b.currentValue),
  };
}

export async function setBasis(propId, basis = {}) {
  requireUser();
  _finSetBasis(me(), propId, basis);
  return getBasis(propId);
}

export async function financeSummary(propId) {
  const mine = me();
  if (!mine || !propId) return { income: 0, expense: 0, net: 0, occupancyRate: null };
  const s = _finSummary(mine, propId) || {};
  return {
    income: Number(s.income) || 0,
    expense: Number(s.expense) || 0,
    net: Number(s.net ?? (Number(s.income) || 0) - (Number(s.expense) || 0)),
    occupancyRate: s.occupancyRate == null ? null : Number(s.occupancyRate),
  };
}

export async function cashflow(propId) {
  const mine = me();
  if (!mine || !propId) return [];
  return (_finCashflow(mine, propId) || []).map((p) => ({
    month: p.month || '',
    income: Number(p.income) || 0,
    expense: Number(p.expense) || 0,
    net: Number(p.net ?? (Number(p.income) || 0) - (Number(p.expense) || 0)),
  }));
}

export async function dues(propId) {
  const mine = me();
  if (!mine || !propId) return [];
  return (_finDues(mine, propId) || []).map((d) => {
    const daysUntil = Number(d.daysUntil ?? d.days) || 0;
    return {
      id: d.id || '',
      propId: String(propId),
      propertyId: String(propId),
      type: d.type || 'expense',
      category: d.category || '',
      amount: Number(d.amount) || 0,
      date: d.date || null,
      note: d.note || '',
      recurring: d.recurring || d.repeat || '',
      nextDue: d.nextDue || d.date || null,
      daysUntil,
      overdue: daysUntil < 0,
    };
  });
}
