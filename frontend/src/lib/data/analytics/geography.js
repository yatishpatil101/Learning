import { rawDb } from './internals.js';

// Localities straight from the DB for the geography charts.
export function localities() {
  return rawDb().localities;
}

export function supplyDemandGap() {
  const db = rawDb();
  const locs = db.localities || [];
  const listings = db.listings || [];
  const enquiries = db.enquiries || [];
  const searchIntents = Array.isArray(db.searchIntents) ? db.searchIntents : [];
  const demandAlerts = Array.isArray(db.demandAlerts) ? db.demandAlerts : [];
  const propertyViews = Array.isArray(db.propertyViews) ? db.propertyViews : [];
  const demandPosts = Array.isArray(db.demandPosts) ? db.demandPosts : [];

  // Count active listings per locality
  const supplyMap = {};
  listings.forEach((l) => {
    if (l.status === 'approved' && !l.archived) {
      const loc = l.locality || 'Unknown';
      supplyMap[loc] = (supplyMap[loc] || 0) + 1;
    }
  });

  // Count demand signals per locality
  const demandMap = {};
  enquiries.forEach((e) => {
    const match = (e.listing || '').split(' in ');
    const loc = match.length > 1 ? match[match.length - 1] : 'Unknown';
    demandMap[loc] = (demandMap[loc] || 0) + 1;
  });

  // Search intents (last 30 days)
  const cutoff30 = Date.now() - 30 * 86400000;
  const cutoff7 = Date.now() - 7 * 86400000;
  const searchMap = {};
  searchIntents.forEach((s) => {
    if (new Date(s.at).getTime() < cutoff30 || !s.locality) return;
    searchMap[s.locality] = (searchMap[s.locality] || 0) + 1;
    demandMap[s.locality] = (demandMap[s.locality] || 0) + 1;
  });

  // Property views (last 30 days)
  const viewMap = {};
  propertyViews.forEach((v) => {
    if (new Date(v.at).getTime() < cutoff30 || !v.locality) return;
    viewMap[v.locality] = (viewMap[v.locality] || 0) + 1;
    demandMap[v.locality] = (demandMap[v.locality] || 0) + 0.5;
  });

  // Demand alerts + demand posts (explicit requests, weighted higher)
  const alertMap = {};
  demandAlerts.forEach((a) => {
    if (!a.locality) return;
    alertMap[a.locality] = (alertMap[a.locality] || 0) + 1;
    demandMap[a.locality] = (demandMap[a.locality] || 0) + 2;
  });
  demandPosts.forEach((p) => {
    if (!p.locality) return;
    alertMap[p.locality] = (alertMap[p.locality] || 0) + 1;
    demandMap[p.locality] = (demandMap[p.locality] || 0) + 3;
  });

  // Hot demand: users who searched same locality 3+ times in 7 days
  const hotMap = {};
  const userLocCount = {};
  searchIntents.forEach((s) => {
    if (new Date(s.at).getTime() < cutoff7 || !s.locality) return;
    const key = `${s.userId}|${s.locality}`;
    userLocCount[key] = (userLocCount[key] || 0) + 1;
  });
  Object.entries(userLocCount).forEach(([key, count]) => {
    if (count >= 3) {
      const loc = key.split('|')[1];
      hotMap[loc] = (hotMap[loc] || 0) + 1;
    }
  });

  // Build rows
  const rows = locs.map((loc) => {
    const supply = supplyMap[loc.name] || loc.listings || 0;
    const demand = Math.round(demandMap[loc.name] || loc.demand * 0.4);
    const searches = searchMap[loc.name] || 0;
    const views = viewMap[loc.name] || 0;
    const alerts = alertMap[loc.name] || 0;
    const hot = hotMap[loc.name] || 0;
    const gap = demand - supply;
    return {
      name: loc.name,
      slug: loc.slug,
      supply,
      demand,
      searches,
      views,
      alerts,
      hot,
      gap,
      ratePerSqft: loc.ratePerSqft,
      avgRent: loc.avgRent,
    };
  });

  return rows.sort((a, b) => b.gap - a.gap);
}

// ---- Demand alerts grouped by locality ----
// Surfaces the "places users want but we don't serve yet" signal from demandAlerts
// (fed by the listings "Create a property alert" card). Mirrors city-expansion demand.
export function alertsByLocality() {
  const db = rawDb();
  const demandAlerts = Array.isArray(db.demandAlerts) ? db.demandAlerts : [];
  const map = {};
  demandAlerts.forEach((a) => {
    const loc = (a.locality || '').trim();
    if (!loc) return;
    if (!map[loc]) map[loc] = { locality: loc, count: 0, lastAt: 0, rent: 0, buy: 0, _types: {} };
    map[loc].count += 1;
    const at = a.at ? new Date(a.at).getTime() : 0;
    if (at > map[loc].lastAt) map[loc].lastAt = at;
    if (a.deal === 'rent') map[loc].rent += 1;
    else if (a.deal === 'buy') map[loc].buy += 1;
    const type = (a.type || '').trim();
    if (type) map[loc]._types[type] = (map[loc]._types[type] || 0) + 1;
  });
  return Object.values(map)
    .map(({ _types, ...rest }) => {
      const top = Object.entries(_types).sort((a, b) => b[1] - a[1])[0];
      return { ...rest, topType: top ? top[0] : '' };
    })
    .sort((a, b) => b.count - a.count);
}
