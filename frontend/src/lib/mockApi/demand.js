// ---------------- Search intent & demand alerts (mock only) ----------------
//
// These three writers back `services/providers/mock/demandProvider.js` and nothing else. Against
// the live API the same three moments become `POST /demand-signals`.
//
// Three exports were deleted here when the seam went in: `getSearchDemand`, `listDemandAlerts` and
// `addDemandPost`. All three had zero callers anywhere in the repo -- `addDemandPost` meant that
// `db.demandPosts` was read by the admin supply-gap aggregation and written by nobody, so one of
// the four demand inputs on that report was permanently empty by construction.
//
// The remaining fields are the ones the server accepts. `budget`, `mobile` and the free-text
// `type` are gone: the demand table stores no contact detail (its only reader is a count) and no
// free text, so keeping them here would let a page depend on data that vanishes the day the domain
// goes live.
import { rawLoad, rawSave, delay } from './core.js';

export function logSearchIntent({ locality, deal, bhk }) {
  const db = rawLoad();
  if (!Array.isArray(db.searchIntents)) db.searchIntents = [];
  db.searchIntents.unshift({
    id: 'SI' + Date.now() + Math.floor(Math.random() * 100),
    locality: locality || '',
    deal: deal || '',
    bhk: bhk || '',
    at: new Date().toISOString(),
  });
  if (db.searchIntents.length > 1000) db.searchIntents = db.searchIntents.slice(0, 1000);
  rawSave(db);
}

export function addDemandAlert({ locality, deal, bhk }) {
  const db = rawLoad();
  if (!Array.isArray(db.demandAlerts)) db.demandAlerts = [];
  db.demandAlerts.unshift({
    id: 'DA' + Date.now(),
    locality: locality || '',
    deal: deal || '',
    bhk: bhk || '',
    at: new Date().toISOString(),
  });
  rawSave(db);
  return delay(true);
}

export function logPropertyView(locality, listingId) {
  const db = rawLoad();
  if (!Array.isArray(db.propertyViews)) db.propertyViews = [];
  db.propertyViews.unshift({ locality: locality || '', listingId: listingId || '', at: new Date().toISOString() });
  if (db.propertyViews.length > 2000) db.propertyViews = db.propertyViews.slice(0, 2000);
  rawSave(db);
}
