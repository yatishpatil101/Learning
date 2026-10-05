import { fmtINR } from './format.js';

const rural = (v) => /rural/i.test(String(v));

/** The priced terms of a rent agreement a desk may re-price; mirrors `ServiceRequestAmendments.Terms`. */
export const AMENDABLE_TERMS = [
  { key: 'rent', label: 'Monthly rent', show: (v) => fmtINR(Number(v)) },
  { key: 'deposit', label: 'Refundable deposit', show: (v) => fmtINR(Number(v)) },
  { key: 'nrDeposit', label: 'Non-refundable deposit', show: (v) => fmtINR(Number(v)) },
  { key: 'months', label: 'Term', show: (v) => `${v} months` },
  { key: 'increment', label: 'Yearly rent increase', show: (v) => `${v}%` },
  {
    key: 'regArea', label: 'Registration area (from Index II)', options: ['urban', 'rural'],
    show: (v) => (rural(v) ? 'Rural / Gram Panchayat' : 'Municipal / Urban'),
  },
];

const FLAT = new Set(['rent', 'deposit', 'nrDeposit', 'months', 'regArea']);
const blank = (v) => v === undefined || v === null || v === '';

/** The value pricing reads: a flat term's top-level copy first, as `ServiceRequestPricing` does. */
export const currentTerm = (details, key) => {
  const top = FLAT.has(key) ? details?.[key] : undefined;
  const value = blank(top) ? details?._state?.terms?.[key] : top;
  if (key === 'regArea') return rural(value) ? 'rural' : 'urban';
  return blank(value) ? '' : String(value);
};

/** `[label, before, after]` for each term the amendment changes. */
export const amendmentRows = (details, terms) => AMENDABLE_TERMS
  .filter((t) => terms?.[t.key] !== undefined && terms?.[t.key] !== null)
  .map((t) => {
    const before = currentTerm(details, t.key);
    return [t.label, before ? t.show(before) : 'not set', t.show(terms[t.key])];
  });
