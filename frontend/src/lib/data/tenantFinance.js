/* Tenant-side finance data layer — the "Rent Wallet".

   Two pure derivations over a rental the tenant recorded themselves: the HRA exemption their rent
   earns them, and what their deposit is costing them to leave with a landlord. Kept out of the
   component so both stay unit-testable, since both are money the tenant will act on.

   ## What used to live here, and why it does not

   `rentSummary`, `rentPassport` and `downloadRentReport` read a history of rent that moved through
   Draazy. That rail was withdrawn, so there is no such history to read — but the reason they are
   deleted rather than re-pointed at the self-declared rental matters more: the PDF was headed
   "Verified rent-payment record" and was written to be handed to a prospective landlord. Rebuilt
   from figures the tenant typed, it would assert as verified something nobody checked. The rent
   totals a tenant does see now (`monthsPaid`, `totalPaid`, `fyPaid`) are computed on the server
   from the lease dates and are presented as the tenant's own statement, which is what they are. */

/* Financial year start (India: 1 Apr). For a date before Apr, the FY started
   the previous calendar year. */
export function fyStart(d = new Date()) {
  return d.getMonth() >= 3 ? new Date(d.getFullYear(), 3, 1) : new Date(d.getFullYear() - 1, 3, 1);
}
export function fyLabel(d = new Date()) {
  const s = fyStart(d);
  const y = s.getFullYear();
  return `FY ${y}–${String(y + 1).slice(-2)}`;
}

/* An ISO date (`YYYY-MM` or `YYYY-MM-DD`) → a Date at the 1st of that month.
   Only whole months are ever asked of it, so the day part is deliberately dropped. */
function monthToDate(m) {
  const [y, mm] = String(m || '').split('-');
  return new Date(Number(y), Number(mm) - 1, 1);
}

/* HRA exemption under Section 10(13A) — the tenant estimate.
   Exemption = min(rent paid − 10% of basic, city% of basic). Pune is a
   NON-metro (40%); the four HRA metros are Delhi, Mumbai, Kolkata, Chennai.
   annualRent/annualBasic are annual ₹. slabRate is the marginal tax fraction. */
export function hraExemption({ annualRent = 0, annualBasic = 0, metro = false, slabRate = 0.2 }) {
  const pct = metro ? 0.5 : 0.4;
  const limitRent = Math.max(0, annualRent - 0.1 * annualBasic);
  const limitPct = pct * annualBasic;
  const exemption = annualBasic > 0 ? Math.max(0, Math.round(Math.min(limitRent, limitPct))) : 0;
  const taxSaved = Math.round(exemption * slabRate);
  return { exemption, taxSaved, limitRent: Math.round(limitRent), limitPct: Math.round(limitPct), pct };
}

/* Deposit position from the tenant's recorded rental: months the money has been locked, expected
   refund date (lease end), and the opportunity cost if it were in a liquid fund.

   A rental with no `deposit` yields zero, and the wallet renders that as "—" rather than "₹0":
   not recorded and none paid are different facts, and only the tenant knows which applies. */
export function depositInfo(rental, liquidRate = 0.065) {
  const deposit = Number(rental?.deposit) || 0;
  const start = rental?.leaseStart ? monthToDate(rental.leaseStart) : null;
  const now = new Date();
  const monthsLocked = start ? Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())) : 0;
  const refundDate = rental?.leaseEnd ? monthToDate(rental.leaseEnd) : null;
  const foregoneAnnual = Math.round(deposit * liquidRate);
  return { deposit, monthsLocked, refundDate, foregoneAnnual };
}
