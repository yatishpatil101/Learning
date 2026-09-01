/* Rent-month arithmetic for the owner's Rent Panel.

   This module used to be the rent ledger: a `puneNestRentLog:<mobile>` bucket in localStorage that
   recorded which months an owner had collected, minted receipts from whatever the browser happened
   to know at print time, and pushed a fake notification alongside. All of that now lives behind
   `services/managedService.js` (`listRentReceipts` / `recordRentReceipt`), because a receipt is a
   document about money: it has to survive a cleared browser, read the same on a phone and on a
   laptop, and say what was true in the month it covers rather than what is true today.

   What is left is what was always pure — turning dates into `YYYY-MM` keys, rendering those keys in
   the visitor's language, and working out which month is due and by when. No storage, no receipt
   generation, no side effects, so nothing here can put a rent record somewhere the server will
   never see it.

   Every "now" below is read in **IST**, never in the browser's zone. The server decides whether a
   month may be receipted against `YearMonth.now(Asia/Kolkata)`, so a device even a few hours ahead
   — an owner in Singapore, a laptop with a wrong clock — would spend the first hours of each month
   being offered a "Mark received" button for a month the server calls the future, and told so in a
   422 it cannot act on. Rent here is an Indian tenancy; its calendar is Pune's, not the reader's. */

const IST = 'Asia/Kolkata';

/** Today's date as Pune sees it. */
function istParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const at = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: at('year'), month: at('month'), day: at('day') };
}

export function ymKey(d = new Date()) {
  const { year, month } = istParts(d);
  return year + '-' + ('0' + month).slice(-2);
}
/* Intl already ships short month names for hi and mr, so a ledger row reads in
   the visitor's language. The locale defaults to English rather than the OS
   locale, so an unthreaded caller can never leak a fourth language into the UI. */
export function ymLabel(ym, locale = 'en') {
  const [y, m] = ym.split('-');
  const month = new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(Number(y), (Number(m) || 1) - 1, 1));
  return `${month} ${y}`;
}

/**
 * When this month's rent falls due.
 *
 * The 1–28 clamp is about February: a due day of 31 would never fall due in four months of the
 * year, and an owner who picks it means "the end of the month" rather than a date that may not
 * exist.
 *
 * Deliberately says nothing about whether the month has been *received*. That is a server fact the
 * panel reads from `listRentReceipts`, and it is the whole reason this module no longer answers it
 * — the browser's answer was only ever true on the one device that recorded it.
 *
 * @returns {{ym:string, label:string, overdue:boolean, dueDay:number}}
 */
export function currentDueStatus(prop, locale = 'en') {
  const { year, month, day } = istParts();
  const ym = year + '-' + ('0' + month).slice(-2);
  const dueDay = Math.min(28, Math.max(1, Number(prop.dueDay) || 5));
  return {
    ym,
    label: ymLabel(ym, locale),
    overdue: day > dueDay,
    dueDay,
  };
}

/**
 * The last `n` month keys, most recent first — the rows of the mini ledger.
 *
 * Just the calendar. The panel joins these against the receipts it fetched to decide which rows are
 * settled, so a month with no receipt renders as outstanding without this module needing to know
 * what a receipt is.
 *
 * @returns {{ym:string, label:string}[]}
 */
export function recentMonths(n = 6, locale = 'en') {
  const { year, month } = istParts();
  const out = [];
  for (let i = 0; i < n; i++) {
    // Plain calendar arithmetic on an IST year/month pair — `Date` is only the month-rollover
    // machinery here, and both ends of it are explicit numbers, so no zone enters.
    const d = new Date(year, month - 1 - i, 1);
    const ym = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
    out.push({ ym, label: ymLabel(ym, locale) });
  }
  return out;
}
