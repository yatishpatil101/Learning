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
  // `db.demandPosts` used to be a fourth input here. Nothing ever wrote it: its only writer,
  // `addDemandPost`, had no callers anywhere in the repo, so one of the four demand sources on this
  // report was empty by construction. Removed with the writer rather than left looking optional.

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

  // Repeat seekers ("hot demand") is not computed here any more, and the mock reports zero.
  //
  // It used to count users who searched the same locality 3+ times in 7 days, keyed on
  // `s.userId` -- but `logSearchIntent` stamped every signed-out searcher with the literal string
  // 'anon', so three searches by three different strangers registered as one hot user. The field
  // is now written only by the server, which counts sessions it can genuinely tell apart, and the
  // mock declines to guess rather than reproducing a number that was never true.
  const hotMap = {};

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

  // Places with demand and no locality record at all.
  //
  // These used to be dropped, because the row set was built purely from `db.localities`. That threw
  // away the single most actionable finding this report can produce: somebody searched for, or set
  // an alert on, a place PuneNest has never listed. Zero supply against real demand is the whole
  // point of a supply-gap report, so an unrecognised locality now gets a row of its own rather than
  // being silently rounded down to nothing. The server does the same -- it groups by the slug it
  // was sent and leaves the display name empty when no locality matches.
  const known = new Set(locs.map((l) => l.name));
  const unknown = new Set([...Object.keys(searchMap), ...Object.keys(viewMap), ...Object.keys(alertMap)]
    .filter((name) => !known.has(name)));
  unknown.forEach((name) => {
    const searches = searchMap[name] || 0;
    const views = viewMap[name] || 0;
    const alerts = alertMap[name] || 0;
    const demand = Math.round(demandMap[name] || 0);
    rows.push({ name, slug: name, supply: 0, demand, searches, views, alerts, hot: 0, gap: demand });
  });

  return rows.sort((a, b) => b.gap - a.gap);
}

// ---- Demand alerts grouped by locality ----
// Deleted with the demand seam. `alertsByLocality()` grouped `db.demandAlerts` by locality for the
// second panel on the Supply Gap tab, adding a deal split, a "last requested" date and the most
// common property type. That panel now reads the `alerts` count off the same server rows as the
// rest of the tab, and the three extra fields are gone rather than reproduced: `demand_signals`
// stores counts, so a deal split would have been the mock's alone and the two modes would have
// disagreed about what the panel meant.
