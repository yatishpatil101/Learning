/* Tenant-side finance data layer — the "Rent Wallet".
   Turns a tenant's rent history plus their finalised tenancy into a money view: rent paid, HRA tax
   saved, deposit locked, and a portable on-time-rent "Rent Passport". Pure/derived helpers so the
   component stays lean and this logic stays unit-testable.

   Every function here takes the payments it works on. It used to default to reading the browser's
   own copy, which meant a caller that had already fetched the tenant's real history could still get
   a summary computed from a stale local one — two numbers for one question. The payments now come
   from `rentService.myRentPayments`, and each carries the `month` its rent settles. */

import { jsPDF } from 'jspdf';

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

/* `YYYY-MM` (payment month key) → a Date at the 1st of that month. */
function monthToDate(m) {
  const [y, mm] = String(m || '').split('-');
  return new Date(Number(y), Number(mm) - 1, 1);
}

/* Rent money summary from real payment history.

   Only settled payments count. Against the local store this was moot — it never held anything but
   successes — but the server keeps the whole ledger, failures included, and a failed charge is not
   rent paid. Counting one would tell a tenant they had paid a month they still owe, and inflate the
   HRA figure they take to their employer. `settled` is the payment's own flag; a row without one is
   read as settled so a caller that hands over rows from somewhere else is not silently zeroed. */
export function rentSummary(payments = []) {
  const fyFrom = fyStart();
  let lifetime = 0;
  let fyPaid = 0;
  const months = new Set();
  const done = payments.filter((p) => p.settled !== false);
  done.forEach((p) => {
    const amt = Number(p.amount) || 0;
    lifetime += amt;
    if (p.month) months.add(p.month);
    if (monthToDate(p.month) >= fyFrom) fyPaid += amt;
  });
  return { lifetime, fyPaid, monthsPaid: months.size, count: done.length };
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

/* Deposit position from the tenancy: months the money has been locked, expected
   refund date (lease end), and the opportunity cost if it were in a liquid fund. */
export function depositInfo(tenancy, liquidRate = 0.065) {
  const deposit = Number(tenancy?.deposit) || 0;
  const start = tenancy?.leaseStart ? monthToDate(tenancy.leaseStart) : null;
  const now = new Date();
  const monthsLocked = start ? Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())) : 0;
  const refundDate = tenancy?.leaseEnd ? monthToDate(tenancy.leaseEnd) : null;
  const foregoneAnnual = Math.round(deposit * liquidRate);
  return { deposit, monthsLocked, refundDate, foregoneAnnual };
}

/* The Rent Passport — a portable, verifiable on-time-rent credential.

   "On time" is now measured rather than assumed. Every recorded payment used to count, which was
   safe against a local store that only ever held successes but is not against the server's ledger:
   a payment that landed after its due date is still rent paid, and it should still count toward the
   history — but calling it on-time in a credential shown to a prospective landlord is a claim the
   dates contradict. A row with no dates counts, since the alternative is penalising a tenant for a
   record the platform failed to stamp.

   Score rewards a paid-rent history, a registered agreement and a verified tenant profile. */
export function rentPassport({ payments = [], tenancy, agreement, profile, user } = {}) {
  const summary = rentSummary(payments);
  const settled = payments.filter((p) => p.settled !== false);
  const onTime = settled.filter((p) => !(p.paidDate && p.dueDate) || p.paidDate <= p.dueDate).length;
  const registered = (agreement?.status || '') === 'registered';
  const verified = !!profile?.verified;
  // 12 on-time payments ≈ full "history" component; agreement + verification top it up.
  const history = Math.min(60, onTime * 5);
  const score = Math.min(100, history + (registered ? 25 : 0) + (verified ? 15 : 0));
  const monthsSorted = settled.map((p) => p.month).filter(Boolean).sort();
  return {
    tenantName: user?.name || tenancy?.tenantName || 'Tenant',
    onTime,
    monthsPaid: summary.monthsPaid,
    totalPaid: summary.lifetime,
    registered,
    verified,
    score,
    since: monthsSorted[0] || null,
    latest: monthsSorted[monthsSorted.length - 1] || null,
    address: tenancy?.address || '',
    landlord: tenancy?.ownerName || agreement?.landlord || 'Landlord',
    rent: Number(tenancy?.rent) || 0,
  };
}

function fmtMonthLabel(m) {
  if (!m) return '—';
  return monthToDate(m).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}
function inr(n) { return '\u20B9' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }

/* One-page Rent Report PDF — the credential a tenant shows a future landlord.
   Reuses jsPDF (already a dependency). Returns true on success. */
export function downloadRentReport(passport, payments = []) {
  try {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const teal = [20, 184, 166];
    // Header band
    doc.setFillColor(15, 13, 26); doc.rect(0, 0, 210, 34, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('PuneNest Rent Passport', 16, 17);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(180);
    doc.text('Verified rent-payment record for ' + (passport.tenantName || 'Tenant'), 16, 25);
    doc.setTextColor(...teal); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    // "Rent Passport score", not "Trust score": the tenant profile carries a server-owned trust
    // score of its own, and two different numbers under one name on two screens is how a tenant
    // ends up quoting the wrong one to a landlord. This one is derived from rent history alone.
    doc.text('Rent Passport score: ' + (passport.score == null ? '—' : passport.score + '/100'), 132, 20);

    let y = 46;
    doc.setTextColor(0); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text('Summary', 16, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(40);
    const rows = [
      ['Rented home', passport.address || '—'],
      ['Landlord', passport.landlord || '—'],
      ['Monthly rent', passport.rent ? inr(passport.rent) : '—'],
      ['On-time payments', String(passport.onTime) + ' months'],
      ['Total rent paid on PuneNest', inr(passport.totalPaid)],
      ['Paying since', fmtMonthLabel(passport.since)],
      ['Registered rent agreement', passport.registered ? 'Yes' : 'No'],
      ['ID-verified tenant', passport.verified ? 'Yes' : 'No'],
    ];
    rows.forEach(([k, v]) => {
      doc.setTextColor(110); doc.text(k, 16, y);
      doc.setTextColor(20); doc.text(String(v), 90, y);
      y += 7;
    });

    y += 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(0);
    doc.text('Payment history', 16, y); y += 7;
    doc.setFontSize(9.5); doc.setTextColor(110);
    doc.text('Month', 16, y); doc.text('Amount', 70, y); doc.text('Method', 110, y); doc.text('Status', 150, y);
    y += 2; doc.setDrawColor(210); doc.line(16, y, 194, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(40);
    /* Settled payments only, and the status is *derived* rather than asserted.

       Both were wrong the moment this read the server instead of the local store. The store held
       nothing but successes, so listing every row and stamping each "On time" happened to be true.
       The server keeps the whole ledger: a failed charge would have appeared in a document the
       tenant hands to a prospective landlord, labelled on time. A payment is on time when it landed
       on or before its due date, which is a fact these rows carry; where they do not carry it, say
       "Paid" rather than claim more than is known. */
    const settled = payments.filter((p) => p.settled !== false);
    settled.slice(0, 24).forEach((p) => {
      if (y > 272) { doc.addPage(); y = 20; }
      doc.text(fmtMonthLabel(p.month), 16, y);
      doc.text(inr(p.amount), 70, y);
      doc.text(String(p.method || 'UPI'), 110, y);
      const onTime = p.paidDate && p.dueDate ? p.paidDate <= p.dueDate : null;
      if (onTime === false) {
        doc.setTextColor(150, 90, 20); doc.text('Late', 150, y);
      } else {
        doc.setTextColor(...teal); doc.text(onTime ? 'On time' : 'Paid', 150, y);
      }
      doc.setTextColor(40);
      y += 6.5;
    });

    doc.setFontSize(8); doc.setTextColor(150);
    doc.text('Generated by PuneNest on ' + new Date().toLocaleDateString('en-IN') + '. Prototype document.', 16, 288);
    doc.save('punenest-rent-passport.pdf');
    return true;
  } catch {
    return false;
  }
}
