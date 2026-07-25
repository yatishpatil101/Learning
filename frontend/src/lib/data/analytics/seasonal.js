import { rawDb, rng } from './internals.js';

// ---- Seasonal Analytics ----
// Pune real-estate seasonal patterns: IT hiring cycles, festivals, monsoon effects.
export function seasonalAnalytics() {
  const db = rawDb();
  const locs = db.localities || [];
  const r = rng(112233);

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Pune-specific seasonal multipliers
  // Rental demand: peaks Jun-Aug (IT hiring), secondary Jan-Mar (new FY)
  const rentMultiplier = [0.85, 0.90, 0.95, 1.0, 1.05, 1.35, 1.40, 1.30, 1.10, 0.90, 0.80, 0.75];
  // Buy demand: peaks Oct-Nov (festivals/Diwali), secondary Apr-May (pre-monsoon)
  const buyMultiplier = [0.80, 0.85, 0.90, 1.10, 1.15, 1.0, 0.75, 0.70, 0.80, 1.30, 1.35, 1.05];
  // Site visits: monsoon Jul-Sep dampens physical visits
  const visitMultiplier = [1.0, 1.05, 1.10, 1.15, 1.10, 0.95, 0.70, 0.65, 0.75, 1.10, 1.15, 1.0];

  // Monthly demand index (combined rent + buy)
  const monthlyDemand = MONTHS.map((m, i) => ({
    month: m,
    rental: Math.round(100 * rentMultiplier[i]),
    buying: Math.round(100 * buyMultiplier[i]),
    visits: Math.round(100 * visitMultiplier[i]),
    combined: Math.round(100 * (rentMultiplier[i] * 0.55 + buyMultiplier[i] * 0.45)),
  }));

  // Seasonal events that impact the market
  const events = [
    { month: 'Jan', label: 'New FY hiring begins', impact: 'rental', direction: 'up' },
    { month: 'Apr', label: 'Pre-monsoon buying window', impact: 'buying', direction: 'up' },
    { month: 'Jun', label: 'IT fresher joins — rental peak', impact: 'rental', direction: 'up' },
    { month: 'Jul', label: 'Monsoon — site visits drop', impact: 'visits', direction: 'down' },
    { month: 'Oct', label: 'Navratri/Diwali — buying peak', impact: 'buying', direction: 'up' },
    { month: 'Dec', label: 'Year-end slowdown', impact: 'combined', direction: 'down' },
  ];

  // Per-locality seasonal profile (based on focus area)
  const localitySeasons = locs.map((loc) => {
    const isRentFocus = loc.focus === 'Rent' || loc.focus === 'Both';
    const isBuyFocus = loc.focus === 'Buy' || loc.focus === 'Both';
    const peakMonths = [];
    const slowMonths = [];

    if (isRentFocus) peakMonths.push('Jun', 'Jul', 'Aug');
    if (isBuyFocus) peakMonths.push('Oct', 'Nov');
    if (isRentFocus) slowMonths.push('Nov', 'Dec');
    if (isBuyFocus) slowMonths.push('Jul', 'Aug');

    // Monthly demand curve for this locality
    const curve = MONTHS.map((m, i) => {
      const base = loc.demand;
      const mult = isRentFocus && isBuyFocus
        ? (rentMultiplier[i] * 0.5 + buyMultiplier[i] * 0.5)
        : isRentFocus ? rentMultiplier[i] : buyMultiplier[i];
      return {
        month: m,
        demand: Math.round(base * mult * (0.95 + r() * 0.1)),
      };
    });

    return {
      name: loc.name,
      focus: loc.focus,
      peakMonths,
      slowMonths,
      curve,
      peakDemand: Math.max(...curve.map((c) => c.demand)),
      lowDemand: Math.min(...curve.map((c) => c.demand)),
    };
  });

  // Year-over-year growth simulation (3 years)
  const yoyGrowth = MONTHS.map((m, i) => ({
    month: m,
    year1: Math.round((70 + r() * 20) * (rentMultiplier[i] * 0.5 + buyMultiplier[i] * 0.5)),
    year2: Math.round((82 + r() * 20) * (rentMultiplier[i] * 0.5 + buyMultiplier[i] * 0.5)),
    year3: Math.round((95 + r() * 20) * (rentMultiplier[i] * 0.5 + buyMultiplier[i] * 0.5)),
  }));

  // Recommendations based on current month
  const now = new Date();
  const currentMonth = now.getMonth(); // 0-indexed
  const recommendations = [];
  if (rentMultiplier[currentMonth] >= 1.2) {
    recommendations.push({ type: 'opportunity', text: 'Rental demand is high this month — prioritize sourcing rental listings in IT corridors (Hinjawadi, Kharadi, Magarpatta).' });
  }
  if (buyMultiplier[currentMonth] >= 1.2) {
    recommendations.push({ type: 'opportunity', text: 'Buying activity peaks this month — push featured buy listings and premium locality ads.' });
  }
  if (visitMultiplier[currentMonth] <= 0.8) {
    recommendations.push({ type: 'caution', text: 'Site visits are seasonally low — increase virtual tour options and video walkthroughs.' });
  }
  if (rentMultiplier[currentMonth] <= 0.85) {
    recommendations.push({ type: 'strategy', text: 'Rental demand is in a seasonal dip — good time to build owner pipeline for next peak.' });
  }
  if (buyMultiplier[currentMonth] <= 0.8) {
    recommendations.push({ type: 'strategy', text: 'Buying activity is low — focus on pre-launch marketing for upcoming festival season.' });
  }

  return {
    months: MONTHS,
    monthlyDemand,
    events,
    localitySeasons,
    yoyGrowth,
    recommendations,
    rentMultiplier,
    buyMultiplier,
    visitMultiplier,
  };
}
