/**
 * Wire ↔ seam translation for the money domain: tenancies, rent payments and property finances.
 *
 * Twenty-one endpoints over three controllers, held together by one object: the **tenancy**. A
 * tenancy is what a rent payment is against, what a mandate authorises, and what makes an owner's
 * finance ledger about a real let rather than a spreadsheet.
 *
 * ## 1. A rent payment is `due` until the gateway says otherwise
 *
 * The single most important thing in this domain, and the same shape the plan slice hit.
 * `POST /me/rent-payments` does **not** record a settled month. It computes the fee, opens a
 * payment-gateway order, and stores the row `due` with the order id in `reference`. Only the
 * signature-verified webhook moves it to `paid`.
 *
 * The mock's `addRentPayment` defaulted to `status: 'paid'`, because a localStorage write cannot
 * fail. That is a lie about money: it tells a tenant their rent is settled the instant they tap,
 * and it tells the owner they have been paid. Both providers now return `due`, so no call site can
 * be written against "tap, therefore paid".
 *
 * ## 2. The fee is the server's, and it always was going to be
 *
 * The client computed `fee = round(amount × rentPayPercent / 100)` and `gst = round(fee × gstPercent
 * / 100)`. So does the server, half-up, in whole rupees, rounding the fee *before* GST — the two
 * agree to the rupee, which is deliberate and worth keeping that way.
 *
 * But a fee the client computes is a fee the client can change: halve `rentPayPercent` in the
 * console and the platform's cut goes with it. So the displayed breakdown is still computed locally
 * (the tenant needs a total *before* they commit, and there is no quote endpoint), while the
 * **charged** breakdown is whatever comes back on the payment. `feesAgree` exists to assert the two
 * have not drifted.
 */

/** Statuses a rent payment can still move out of. `paid` and `failed` are terminal. */
const LIVE_PAYMENT_STATUSES = ['due', 'overdue'];

/** True once the money has actually landed. Not "the POST returned 201". */
export const isSettled = (status) => status === 'paid';

/** True while a payment is open against a gateway order — charged intent, unconfirmed money. */
export const isAwaitingSettlement = (status) => LIVE_PAYMENT_STATUSES.includes(status);

/**
 * The fee breakdown for a rent amount, computed the way the server computes it.
 *
 * `round(base × percent / 100)` in whole rupees, half-up, with the fee rounded before GST is taken
 * on it. GST is charged on the **fee**, not the rent: the platform is selling a payment service and
 * the rent itself is not a taxable supply by us.
 *
 * This is for *display before paying*. The authoritative numbers are the ones on the returned
 * payment — see `feesAgree`.
 */
export function quoteRentFee(amount, { rentPayPercent = 2, gstPercent = 18 } = {}) {
  const base = Math.max(0, Math.round(Number(amount) || 0));
  const fee = Math.round((base * Number(rentPayPercent)) / 100);
  const gst = Math.round((fee * Number(gstPercent)) / 100);
  return { amount: base, fee, gst, platform: fee + gst, total: base + fee + gst };
}

/**
 * Do the quoted fee and the charged fee match?
 *
 * A mismatch means the tenant was shown one total and billed another — the same class of defect as
 * the plan price divergence (D108), and worth catching rather than rendering both numbers happily.
 */
export const feesAgree = (quote, payment) =>
  !!payment && quote.fee === Number(payment.platformFee) && quote.gst === Number(payment.gst);

/** Wire `RentPaymentDto` → the seam's payment shape. */
export function toRentPaymentViewModel(row) {
  const status = row?.status || 'due';
  return {
    id: row?.id || '',
    tenancyId: row?.tenancyId || '',
    amount: Number(row?.amount) || 0,
    platformFee: Number(row?.platformFee) || 0,
    gst: Number(row?.gst) || 0,
    // What the tenant is actually charged. The wire sends the three parts and leaves the sum to the
    // reader, which is right — but every call site wants the total, so it is derived once here.
    total: (Number(row?.amount) || 0) + (Number(row?.platformFee) || 0) + (Number(row?.gst) || 0),
    dueDate: row?.dueDate || null,
    paidDate: row?.paidDate || null,
    status,
    settled: isSettled(status),
    method: row?.method || '',
    // The gateway order id. This is how the webhook finds the row again, and the only handle the
    // tenant has if they need to ask what happened to a payment.
    reference: row?.reference || '',
    failureReason: row?.failureReason || '',
    // The single-use Cashfree session, present only on the `payRent` response for a freshly opened
    // order and null on every ledger read (D167). Mirrors `planMapper`'s subscription shape so a
    // checkout can be opened from whatever the seam returns rather than from component state.
    paymentSessionId: row?.paymentSessionId ?? null,
  };
}

/**
 * Wire `TenancyDto` → the seam's tenancy shape.
 *
 * ## 3. The same row is read from both ends
 *
 * `GET /me/tenancies` is the tenant's view and `GET /tenancies` is the owner's, over the same
 * table. So the view model carries **both** parties rather than a single "them", and the caller
 * decides which side they are on. Collapsing it to one counterparty here would mean two shapes for
 * one row, and a component that could not be reused across the two dashboards.
 */
export function toTenancyViewModel(row) {
  return {
    id: row?.id || '',
    propId: row?.propertyId || '',
    propertyId: row?.propertyId || '',
    rent: Number(row?.rent) || 0,
    deposit: Number(row?.deposit) || 0,
    startDate: row?.startDate || null,
    endDate: row?.endDate || null,
    status: row?.status || 'active',
    active: (row?.status || 'active') === 'active',
    tenantId: row?.tenant?.id || '',
    tenantName: row?.tenant?.name || '',
    // Contact-gated server-side; passed through as it arrives. Masking is the server's decision.
    tenantMobile: row?.tenant?.mobile || '',
    ownerId: row?.owner?.id || '',
    ownerName: row?.owner?.name || '',
    ownerMobile: row?.owner?.mobile || '',
  };
}

/**
 * Wire `TenantProfileDto` → the seam's shape.
 *
 * ## 4. The tenant score is the server's, and `verified` is not `idVerified`
 *
 * The client scored a profile itself (`tenantScore`) from how many fields were filled in. The
 * server returns `score`, so the client's arithmetic is no longer the answer — two different
 * numbers for one profile is worse than one number somebody disagrees with.
 *
 * `verified` also means something narrower than the mock's `idVerified`: it is the server's
 * verification state, not "this browser once ticked a box". The rename is deliberate so a call site
 * cannot read the old field and silently get `undefined` (falsy, so it fails closed — but silently).
 */
export function toTenantProfileViewModel(row) {
  if (!row || (!row.mobile && !row.name)) return null;
  return {
    mobile: row.mobile || '',
    name: row.name || '',
    occupation: row.occupation || '',
    income: row.income == null ? null : Number(row.income),
    occupants: row.occupants || '',
    moveIn: row.moveIn || null,
    priorLandlord: row.priorLandlord || '',
    about: row.about || '',
    score: row.score == null ? null : Number(row.score),
    verified: !!row.verified,
  };
}

/** Wire `RentMandateDto` → the seam's shape. `none()` comes back all-null, which reads as "no mandate". */
export function toMandateViewModel(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    tenancyId: row.tenancyId || '',
    maxAmount: Number(row.maxAmount) || 0,
    dayOfMonth: row.dayOfMonth == null ? null : Number(row.dayOfMonth),
    status: row.status || 'inactive',
    active: (row.status || '') === 'active',
    provider: row.provider || '',
  };
}

/**
 * Wire `PayoutAccountDto` → the seam's shape.
 *
 * ## 5. The account number never comes back
 *
 * `PayoutAccountUpdateRequest` takes `accountNumber`; `PayoutAccountDto` returns `maskedAccount`.
 * That asymmetry is the point — the server will not re-serve a full bank account number to anyone,
 * including its owner. The mock stored and returned it in the clear.
 *
 * So `hasPayoutAccount` cannot test `accountNumber` any more. It tests whether the server says
 * there is one, which is the only question a client can honestly answer.
 */
export function toPayoutAccountViewModel(row) {
  const holder = row?.accountHolder || '';
  const masked = row?.maskedAccount || '';
  const upi = row?.upiId || '';
  return {
    accountHolder: holder,
    maskedAccount: masked,
    ifsc: row?.ifsc || '',
    upiId: upi,
    verified: !!row?.verified,
    // Configured at all? A bank account or a UPI id is enough; the holder alone is not.
    configured: !!(masked || upi),
  };
}

/* ─── Property finances ─────────────────────────────────────────────────────────────────────── */

/** Wire `TransactionDto` → the seam's shape. Dates stay ISO `YYYY-MM-DD`, as the ledger renders them. */
export function toTransactionViewModel(row) {
  return {
    id: row?.id || '',
    propId: row?.propertyId || '',
    propertyId: row?.propertyId || '',
    type: row?.type || 'expense',
    category: row?.category || '',
    amount: Number(row?.amount) || 0,
    date: row?.date || null,
    note: row?.note || '',
    recurring: row?.recurring || '',
  };
}

/**
 * ## 6. The summary, the cashflow and the dues are the server's arithmetic now
 *
 * `financeSummary`, `cashflowByMonth` and `getDues` were client-side reductions over the whole
 * transaction list. Three endpoints now answer them directly, which matters for a reason beyond
 * tidiness: the client versions could only ever be right about transactions the client had
 * downloaded, and the ledger is paged.
 *
 * A reduction over page one of a paged list is not a summary — it is a summary of page one, quietly
 * mislabelled.
 */
export const toSummaryViewModel = (row) => ({
  income: Number(row?.income) || 0,
  expense: Number(row?.expense) || 0,
  net: Number(row?.net) || 0,
  occupancyRate: row?.occupancyRate == null ? null : Number(row.occupancyRate),
});

export const toCashflowPoint = (row) => ({
  month: row?.month || '',
  income: Number(row?.income) || 0,
  expense: Number(row?.expense) || 0,
  net: Number(row?.net) || 0,
});

/** Wire `DueDto` → the seam's shape. `daysUntil` is server-computed, so it cannot drift by timezone. */
export const toDueViewModel = (row) => ({
  id: row?.id || '',
  propId: row?.propertyId || '',
  propertyId: row?.propertyId || '',
  type: row?.type || 'expense',
  category: row?.category || '',
  amount: Number(row?.amount) || 0,
  date: row?.date || null,
  note: row?.note || '',
  recurring: row?.recurring || '',
  nextDue: row?.nextDue || null,
  daysUntil: Number(row?.daysUntil) || 0,
  overdue: (Number(row?.daysUntil) || 0) < 0,
});

/** Wire `OwnershipBasisDto` → the seam's shape. All-null is a property with no basis recorded. */
export function toBasisViewModel(row) {
  const has = row && (row.purchasePrice != null || row.purchaseDate || row.currentValue != null);
  if (!has) return null;
  return {
    purchasePrice: row.purchasePrice == null ? null : Number(row.purchasePrice),
    purchaseDate: row.purchaseDate || null,
    loanOutstanding: row.loanOutstanding == null ? null : Number(row.loanOutstanding),
    emi: row.emi == null ? null : Number(row.emi),
    currentValue: row.currentValue == null ? null : Number(row.currentValue),
  };
}
