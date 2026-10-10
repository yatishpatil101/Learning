export const PUNE_STAMP_RATE_PCT = 7;
const REGISTRATION_FEE_CAP = 30000;
export const MAX_RECEIPT_MONTHS = 12;

export function computeStampDuty(value, ratePct) {
  const v = Math.max(value, 0);
  const stamp = Math.round((v * ratePct) / 100);
  const reg = Math.min(Math.round(v * 0.01), REGISTRATION_FEE_CAP);
  return { stamp, reg, total: stamp + reg, rate: ratePct };
}

/* Rent for the whole term when it rises by `incrementPct` after every `every` (11 or 12) months. */
export const rentForTerm = (rent, months, incrementPct, every) => {
  const pct = Number(incrementPct);
  const bps = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.round(pct * 100) : 0;
  const step = parseInt(every, 10) === 12 ? 12 : 11;
  let monthly = rent, total = 0;
  for (let paid = 0; paid < months; paid += step) {
    if (paid > 0) monthly = Math.floor((monthly * (10000 + bps) + 5000) / 10000);
    total += monthly * Math.min(step, months - paid);
  }
  return total;
};

/* Art. 36A: 0.25% of rent + non-refundable money + 10% a year on the deposit, rounded up to ₹100 (min ₹100). */
export const leaveLicenceStamp = (rentTotal, nonRefundable, deposit, years) =>
  Math.max(100, Math.ceil(((rentTotal + nonRefundable) * 10 + deposit * years) / 400000) * 100);

export function rentalYield({ price, rent, maintenance, propertyTax, vacancyMonths }) {
  const vacant = Math.min(Math.max(vacancyMonths, 0), 12);
  const grossRent = rent * 12;
  const netIncome = rent * (12 - vacant) - maintenance * 12 - propertyTax;
  if (!(price > 0)) return { grossRent, netIncome, gross: null, net: null, payback: null };
  return {
    grossRent,
    netIncome,
    gross: (grossRent / price) * 100,
    net: (netIncome / price) * 100,
    payback: netIncome > 0 ? price / netIncome : null,
  };
}

/** 'YYYY-MM' values from `from` to `to` inclusive; empty when either is missing, reversed or longer than the cap. */
export function monthsBetween(from, to) {
  const ok = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!ok.test(from) || !ok.test(to) || to < from) return [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const count = (ty - fy) * 12 + (tm - fm) + 1;
  if (count > MAX_RECEIPT_MONTHS) return [];
  return Array.from({ length: count }, (_, i) => {
    const idx = fy * 12 + (fm - 1) + i;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
  });
}

export const isPan = (s) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s);
