import { parseAmount } from '../../../lib/format';

/* ---------- money / number formatting helpers ---------- */
export const formatIndian = (v) => {
  const s = String(v ?? '').replace(/\D/g, '');
  if (!s) return '';
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3;
};

export const moneyWords = (v) => {
  const num = parseAmount(v);
  if (!num) return '';
  if (num >= 10000000) return `≈ ₹ ${(num / 10000000).toFixed(2).replace(/\.00$/, '')} Crore`;
  if (num >= 100000) return `≈ ₹ ${(num / 100000).toFixed(2).replace(/\.00$/, '')} Lakh`;
  if (num >= 1000) return `≈ ₹ ${(num / 1000).toFixed(2).replace(/\.00$/, '')} Thousand`;
  return `≈ ₹ ${num}`;
};

// Derived price transparency — buyers compare on ₹/sq.ft, so surface it from the
// price and area they've already entered. Returns '' until both are present.
export const perSqft = (amount, area) => {
  const price = parseAmount(amount);
  const sqft = parseAmount(area);
  if (!price || !sqft) return '';
  return `≈ ₹ ${formatIndian(Math.round(price / sqft))} / sq.ft`;
};
