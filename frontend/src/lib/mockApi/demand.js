// ---------------- Search intent & demand alerts ----------------
import { rawLoad, rawSave, delay } from './core.js';

export function logSearchIntent({ locality, deal, bhk, budget, userId }) {
  const db = rawLoad();
  if (!Array.isArray(db.searchIntents)) db.searchIntents = [];
  db.searchIntents.unshift({
    id: 'SI' + Date.now() + Math.floor(Math.random() * 100),
    locality: locality || '',
    deal: deal || '',
    bhk: bhk || '',
    budget: budget || '',
    userId: userId || 'anon',
    at: new Date().toISOString(),
  });
  if (db.searchIntents.length > 1000) db.searchIntents = db.searchIntents.slice(0, 1000);
  rawSave(db);
}

export function getSearchDemand() {
  const db = rawLoad();
  const intents = Array.isArray(db.searchIntents) ? db.searchIntents : [];
  const alerts = Array.isArray(db.demandAlerts) ? db.demandAlerts : [];

  // Aggregate searches by locality (last 30 days)
  const cutoff = Date.now() - 30 * 86400000;
  const searchMap = {};
  intents.forEach((s) => {
    if (new Date(s.at).getTime() < cutoff) return;
    const loc = s.locality || 'Unknown';
    if (!searchMap[loc]) searchMap[loc] = { searches: 0, deals: {} };
    searchMap[loc].searches++;
    if (s.deal) searchMap[loc].deals[s.deal] = (searchMap[loc].deals[s.deal] || 0) + 1;
  });

  // Aggregate alerts by locality
  const alertMap = {};
  alerts.forEach((a) => {
    const loc = a.locality || 'Unknown';
    alertMap[loc] = (alertMap[loc] || 0) + 1;
  });

  return { searchMap, alertMap, totalSearches: intents.filter((s) => new Date(s.at).getTime() >= cutoff).length, totalAlerts: alerts.length };
}

export function addDemandAlert({ locality, deal, type, bhk, budget, mobile }) {
  const db = rawLoad();
  if (!Array.isArray(db.demandAlerts)) db.demandAlerts = [];
  db.demandAlerts.unshift({
    id: 'DA' + Date.now(),
    locality: locality || '',
    deal: deal || '',
    type: type || '',
    bhk: bhk || '',
    budget: budget || '',
    mobile: mobile || '',
    at: new Date().toISOString(),
  });
  rawSave(db);
  return delay(true);
}

export function listDemandAlerts() {
  const db = rawLoad();
  return delay(Array.isArray(db.demandAlerts) ? db.demandAlerts : []);
}

export function logPropertyView(locality, listingId) {
  const db = rawLoad();
  if (!Array.isArray(db.propertyViews)) db.propertyViews = [];
  db.propertyViews.unshift({ locality: locality || '', listingId: listingId || '', at: new Date().toISOString() });
  if (db.propertyViews.length > 2000) db.propertyViews = db.propertyViews.slice(0, 2000);
  rawSave(db);
}

export function addDemandPost({ locality, deal, bhk, budget, mobile, note }) {
  const db = rawLoad();
  if (!Array.isArray(db.demandPosts)) db.demandPosts = [];
  db.demandPosts.unshift({
    id: 'DP' + Date.now(),
    locality: locality || '',
    deal: deal || '',
    bhk: bhk || '',
    budget: budget || '',
    mobile: mobile || '',
    note: note || '',
    at: new Date().toISOString(),
  });
  rawSave(db);
  return delay(true);
}
