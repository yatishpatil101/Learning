import { rawDb, rng } from './internals.js';

// ---- Competitive Pricing Insight ----
// Analyses listing prices against locality market rates to identify over/under-priced listings
// and compute rental yield + price-per-sqft comparisons.
export function pricingInsight() {
  const db = rawDb();
  const listings = db.listings || [];
  const locs = db.localities || [];

  // Build locality lookup
  const locMap = {};
  locs.forEach((l) => {
    locMap[l.name] = l;
  });

  // Pre-group approved listings by locality (avoids N+1 re-scanning)
  const approvedByLocality = {};
  listings.forEach((l) => {
    if (l.status === 'approved') {
      (approvedByLocality[l.locality] ||= []).push(l);
    }
  });

  // Per-locality pricing aggregates
  const locStats = locs.map((loc) => {
    const locListings = approvedByLocality[loc.name] || [];
    const buyListings = locListings.filter((l) => l.deal === 'buy');
    const rentListings = locListings.filter((l) => l.deal === 'rent');

    // Actual ₹/sqft from buy listings
    const actualRates = buyListings.map((l) => Math.round(l.price / l.area));
    const avgActualRate = actualRates.length
      ? Math.round(actualRates.reduce((a, b) => a + b, 0) / actualRates.length)
      : loc.ratePerSqft;

    // Rental yield: (annual rent / property value) * 100
    const yields = rentListings
      .filter((l) => l.area && loc.ratePerSqft)
      .map((l) => ((l.price * 12) / (l.area * loc.ratePerSqft)) * 100);
    const avgYield = yields.length
      ? +(yields.reduce((a, b) => a + b, 0) / yields.length).toFixed(1)
      : +(((loc.avgRent * 12) / (loc.ratePerSqft * 1000)) * 100).toFixed(1);

    return {
      name: loc.name,
      slug: loc.slug,
      marketRate: loc.ratePerSqft,
      avgActualRate,
      avgRent: loc.avgRent,
      rentalYield: avgYield,
      buyCount: buyListings.length,
      rentCount: rentListings.length,
      totalListings: locListings.length,
      demand: loc.demand,
    };
  });

  // Individual listing price position (how each listing compares to market)
  const pricePositions = listings
    .filter((l) => l.status === 'approved' && locMap[l.locality])
    .map((l) => {
      const loc = locMap[l.locality];
      const marketPrice = l.deal === 'buy'
        ? l.area * loc.ratePerSqft
        : loc.avgRent * (l.bhkNum || 2) * 0.5;
      if (!marketPrice) return null; // guard against division by zero
      const deviation = Math.round(((l.price - marketPrice) / marketPrice) * 100);
      return {
        id: l.id,
        title: l.title,
        locality: l.locality,
        deal: l.deal,
        price: l.price,
        area: l.area,
        bhk: l.bhk,
        marketPrice,
        deviation,
        views: l.views || 0,
        enquiries: l.enquiries || 0,
        label: deviation > 15 ? 'overpriced' : deviation < -15 ? 'underpriced' : 'fair',
      };
    })
    .filter(Boolean);

  // Simulated 6-month price trend per locality (deterministic)
  const r = rng(777777);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  const priceTrends = locs.slice(0, 8).map((loc) => {
    const base = loc.ratePerSqft;
    const trend = months.map((m, i) => {
      const growth = 1 + (i * 0.008) + (r() * 0.02 - 0.005);
      return { month: m, rate: Math.round(base * growth) };
    });
    return { name: loc.name, trend };
  });

  // Count by label in a single pass
  const counts = { overpriced: 0, underpriced: 0, fair: 0 };
  pricePositions.forEach((p) => counts[p.label]++);

  // Best yield localities (sorted)
  const yieldRanking = [...locStats].sort((a, b) => b.rentalYield - a.rentalYield);

  return {
    locStats,
    pricePositions,
    priceTrends,
    yieldRanking,
    summary: {
      totalAnalysed: pricePositions.length,
      overpriced: counts.overpriced,
      underpriced: counts.underpriced,
      fair: counts.fair,
      avgYield: +(locStats.reduce((s, l) => s + l.rentalYield, 0) / locStats.length).toFixed(1),
      highestRate: Math.max(...locStats.map((l) => l.marketRate)),
      lowestRate: Math.min(...locStats.map((l) => l.marketRate)),
    },
  };
}
