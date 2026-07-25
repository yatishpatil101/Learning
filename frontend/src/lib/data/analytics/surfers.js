import { rng } from './internals.js';
import { trafficSeries } from './traffic.js';

// ---- Anonymous surfers / free-riders analytics ----
// Generates realistic data about visitors who browse but never sign up.
// Accepts a pre-computed traffic series to avoid redundant recomputation.
export function anonymousSurfers(days = 30, precomputedTraffic) {
  const r = rng(987654);
  const traffic = precomputedTraffic ?? trafficSeries(days);
  const totalVisits = traffic.reduce((a, b) => a + b.visits, 0);
  const totalSignups = traffic.reduce((a, b) => a + b.signups, 0);
  const signedInSessions = Math.min(totalSignups * 12, totalVisits); // each signup user visits ~12 times
  const anonSessions = totalVisits - signedInSessions;

  // Pages most visited by anonymous users (proportional to page popularity, skewed toward discovery)
  const anonPages = [
    { page: 'Home', views: Math.round(anonSessions * 0.92), signupRate: 2.1 },
    { page: 'Listings (Buy)', views: Math.round(anonSessions * 0.64), signupRate: 3.4 },
    { page: 'Listings (Rent)', views: Math.round(anonSessions * 0.58), signupRate: 3.8 },
    { page: 'Property detail', views: Math.round(anonSessions * 0.41), signupRate: 5.2 },
    { page: 'Services', views: Math.round(anonSessions * 0.22), signupRate: 1.9 },
    { page: 'Locality insights', views: Math.round(anonSessions * 0.18), signupRate: 1.4 },
    { page: 'EMI calculator', views: Math.round(anonSessions * 0.15), signupRate: 4.1 },
    { page: 'Share a flat', views: Math.round(anonSessions * 0.09), signupRate: 6.8 },
  ];

  // Weekly trend: anon vs signed-in
  const weeks = [];
  const chunkSize = Math.ceil(days / 8);
  for (let w = 0; w < 8; w++) {
    const slice = traffic.slice(w * chunkSize, (w + 1) * chunkSize);
    const wVisits = slice.reduce((a, b) => a + b.visits, 0);
    const wSignups = slice.reduce((a, b) => a + b.signups, 0);
    const wSignedIn = Math.min(wSignups * (11 + r() * 3), wVisits);
    weeks.push({ week: `W${w + 1}`, anon: Math.round(wVisits - wSignedIn), signedIn: Math.round(wSignedIn) });
  }

  // Drop-off points: where anon users exit without signing up
  const dropOff = [
    { page: 'Property detail (contact wall)', pct: 34 },
    { page: 'Listings (after 3+ views)', pct: 22 },
    { page: 'Services (quote form)', pct: 18 },
    { page: 'Share a flat (post)', pct: 12 },
    { page: 'EMI calculator (results)', pct: 8 },
    { page: 'Other', pct: 6 },
  ];

  return {
    totalVisits,
    totalSignups,
    anonSessions,
    signedInSessions,
    conversionRate: ((totalSignups / totalVisits) * 100).toFixed(1),
    anonPct: ((anonSessions / totalVisits) * 100).toFixed(0),
    anonPages,
    weeks,
    dropOff,
  };
}
