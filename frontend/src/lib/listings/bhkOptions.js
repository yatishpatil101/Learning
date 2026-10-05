export const BHK_OPTIONS = {
  buy: [['0', '1 RK'], ['1', '1 BHK'], ['2', '2 BHK'], ['3', '3 BHK'], ['4', '4 BHK'], ['5plus', '5+ BHK']],
  rent: [['0', '1 RK'], ['1', '1 BHK'], ['2', '2 BHK'], ['3', '3 BHK'], ['4plus', '4+ BHK']],
};

export const BHK_KEYS = Object.fromEntries(Object.entries(BHK_OPTIONS).map(([deal, opts]) => [deal, opts.map(([key]) => key)]));

const validDeal = (deal) => (deal === 'rent' ? 'rent' : 'buy');
const keyFloor = (key) => Number(String(key).replace('plus', ''));

const openKeysFrom = (from, deal) => {
  const matches = BHK_KEYS[deal].filter((key) => {
    const floor = keyFloor(key);
    return Number.isFinite(floor) && floor >= from;
  });
  if (matches.length) return matches;
  const fallback = BHK_KEYS[deal]
    .filter((key) => key.endsWith('plus') && keyFloor(key) <= from)
    .sort((a, b) => keyFloor(b) - keyFloor(a))[0];
  return fallback ? [fallback] : [];
};

export function expandBhkToken(token, deal, { source = 'state' } = {}) {
  const d = validDeal(deal);
  const key = String(token ?? '').trim().toLowerCase();
  const keys = BHK_KEYS[d];
  if (!key) return [];
  if (source === 'legacy' && d === 'buy' && key === '4') return ['4', '5plus'];
  if (keys.includes(key)) return [key];
  if (/^\d+plus$/.test(key)) return openKeysFrom(Number(key.replace('plus', '')), d);
  const n = Number(key);
  if (!Number.isFinite(n)) return [];
  if (n <= 0) return keys.includes('0') ? ['0'] : [];
  if (keys.includes(String(n))) return [String(n)];
  return openKeysFrom(n, d);
}

export const normBhk = (token, deal) => expandBhkToken(token, deal)[0] || null;
