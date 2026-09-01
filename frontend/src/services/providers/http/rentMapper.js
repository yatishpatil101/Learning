/**
 * Wire ↔ seam translation for the tenancy domain: tenancies, tenant profiles, rent agreements and
 * per-property finances.
 *
 * Fourteen endpoints over three controllers, held together by one object: the **tenancy**. A
 * tenancy is what a rent agreement papers, what a declaration claims, and what makes an owner's
 * finance ledger about a real let rather than a spreadsheet.
 *
 * ## 1. Nothing here moves rent
 *
 * There were mappers for a rent payment, an auto-pay mandate and an owner payout account. That rail
 * was withdrawn and the endpoints are gone from the contract, so the mappers went with them rather
 * than sitting here translating a shape the server can no longer send. `/pay-rent` is a static
 * coming-soon page.
 */

/**
 * Wire `TenancyDto` → the seam's tenancy shape.
 *
 * ## 2. The same row is read from both ends
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
 * Wire `TenancyDeclaration` → the seam's shape (D194).
 *
 * ## 3a. `propId` carries the identifier the page already holds
 *
 * Named `propId` and set from the wire's `propertyId` for the same reason `toTenancyViewModel`
 * carries both: the property page compares it against `p.uuid || p.id`, which is the listing's UUID
 * against this API and its slug under the mock. That single resolution is what keeps the comparison
 * true on both providers — the tenancy half of review eligibility was dead for a year because one
 * side of it compared a slug to a UUID and quietly matched nothing (D194).
 *
 * `status` is the only field with authority here. `pending` is somebody's unopposed assertion,
 * `revoked` is one the owner took back, and only `confirmed` proves a stay — so callers must branch
 * on it rather than on the row's existence.
 */
export function toTenancyDeclarationViewModel(row) {
  return {
    id: row?.id || '',
    propId: row?.propertyId || '',
    propertyId: row?.propertyId || '',
    declarantId: row?.declarantId || '',
    declarantName: row?.declarantName || '',
    livedFrom: row?.livedFrom || null,
    livedTo: row?.livedTo || null,
    status: row?.status || 'pending',
    confirmed: row?.status === 'confirmed',
    decidedAt: row?.decidedAt || null,
  };
}

/**
 * Wire `TenantProfileDto` → the seam's shape.
 *
 * ## 3. The tenant score is the server's, and `verified` is not `idVerified`
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
 * Wire `TenantRental` → the seam's shape: a home the tenant says they rent, off-platform.
 *
 * `monthsPaid`, `totalPaid` and `fyPaid` are copied straight through and never recomputed. They
 * are the server's arithmetic over the lease dates, and the April–March financial year has exactly
 * one definition — re-deriving it here is how the tile and the export would come to disagree by a
 * month, in a number a tenant repeats to their employer.
 *
 * Nothing produced here is evidence. `monthlyRent` is what the tenant typed, not what the platform
 * saw move, so this shape must never feed the Rent Passport — that document says "verified".
 */
export function toRentalViewModel(row) {
  return {
    id: row?.id || '',
    address: row?.address || '',
    landlordName: row?.landlordName || '',
    monthlyRent: Number(row?.monthlyRent) || 0,
    // Absent means "not recorded", which is not the same as a zero deposit.
    deposit: row?.deposit == null ? null : Number(row.deposit),
    leaseStart: row?.leaseStart || null,
    leaseEnd: row?.leaseEnd || null,
    status: row?.status || 'active',
    monthsPaid: Number(row?.monthsPaid) || 0,
    totalPaid: Number(row?.totalPaid) || 0,
    fyPaid: Number(row?.fyPaid) || 0,
  };
}

/**
 * ## 4. The summary, the cashflow and the dues are the server's arithmetic now
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

/**
 * Wire `RentAgreement` → the seam's shape.
 *
 * `propId` mirrors the wire's `propertyId` for the reason `toTenancyViewModel` gives: the document
 * vault matches an agreement to the selected flat by comparing `propId`, and a rename here is what
 * keeps that comparison true against both providers.
 *
 * `endDate` is derived rather than carried, because the record stores a start plus a term in months
 * and an end date computed anywhere else would be a second, driftable copy of the same fact. The
 * arithmetic is deliberately on a UTC date so a lease that starts on the 1st does not display as
 * ending on the last day of the previous month for a reader east of Greenwich.
 *
 * The counterparties' *names* are not on the wire — the record identifies its tenant by mobile
 * only, since an owner may file it before that person has an account. Callers already fall back to
 * the tenancy's `ownerName` or a generic label, which is the honest answer rather than a guess.
 */
export function toRentAgreementViewModel(row) {
  const startDate = row?.startDate || null;
  const months = Number(row?.durationMonths) || 0;
  let endDate = null;
  if (startDate && months > 0) {
    const start = new Date(`${startDate}T00:00:00Z`);
    if (!Number.isNaN(start.getTime())) {
      // A lease running `months` from the 1st ends on the last day of the final month, so step to
      // the month after and back off one day rather than landing on the start-of-month boundary.
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()));
      end.setUTCDate(end.getUTCDate() - 1);
      endDate = end.toISOString().slice(0, 10);
    }
  }
  return {
    id: row?.id || '',
    propId: row?.propertyId || '',
    propertyId: row?.propertyId || '',
    tenantMobile: row?.tenantMobile || '',
    rent: Number(row?.rent) || 0,
    deposit: Number(row?.deposit) || 0,
    startDate,
    durationMonths: months || null,
    endDate,
    date: startDate,
    status: row?.status || 'draft',
    documentUrl: row?.documentUrl || null,
  };
}
