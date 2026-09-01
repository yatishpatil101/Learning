/* PuneNest — Documents data module for Dashboard.
   Manages property documents (owner), buyer document requests, and the home-loan checklist.
   Uses the same localStorage keys as the HTML prototype for data interop. */

import { digits } from '../contact.js';
import { pushNotificationFor } from '../store.js';
import { isHttpDomain } from '../../services/config.js';

const DOC_CATEGORIES = {
  'Title & Ownership': ['Sale Deed', 'Agreement to Sale', 'Mother Deed / Title Chain', 'Conveyance Deed', 'Index II', '7/12 Extract / Property Card', 'Encumbrance Certificate', 'Legal Title Search Report'],
  'Society': ['Society Registration Certificate', 'Society NOC', 'Share Certificate', 'Maintenance Receipt'],
  'Approvals & Plans': ['Sanctioned Building Plan', 'Floor Plan', 'Commencement Certificate', 'Occupancy Certificate', 'Completion Certificate', 'RERA Certificate', 'NA Order (Non-Agricultural)'],
  'Purchase & Payments': ['Allotment Letter', 'Possession Letter', 'Builder Payment Receipts', 'Stamp Duty & Registration Receipt', 'Property Valuation Report'],
  'Tax & Utilities': ['Property Tax Receipt', 'Electricity Bill'],
};
export { DOC_CATEGORIES };

export const ALL_DOC_TYPES = Object.values(DOC_CATEGORIES).flat().concat(['Other']);

/* Plain-language "what is this & why do I need it?" copy for each document, shown via <Tip> on the
   Documents tab (hover on desktop, tap on mobile). Voice: help a first-time Pune owner/tenant
   understand each paper's significance. Keyed by the exact slot name used in the tab. */
export const DOC_INFO = {
  // ---- Title & Ownership ------------------------------------------------------
  'Sale Deed': { title: 'Sale Deed', body: 'The core legal proof that ownership was transferred to you. Registered at the sub-registrar, it is the single most important document a buyer or bank will ask to see.' },
  'Agreement to Sale': { title: 'Agreement to Sale', body: 'The contract recording the agreed price and terms before the final sale. It shows the transaction history and any conditions between buyer and seller.' },
  'Mother Deed / Title Chain': { title: 'Mother Deed / Title Chain', body: 'Traces ownership back through every past owner. Buyers and banks use it to confirm the title is unbroken and dispute-free.' },
  'Conveyance Deed': { title: 'Conveyance Deed', body: 'Transfers land ownership to the society/owner. For flats, a deemed conveyance proves the society legally holds the land under the building.' },
  'Index II': { title: 'Index II', body: 'A one-page summary the registrar issues for a registered deed — names, property details and value. It is the quickest proof that a sale was officially registered.' },
  '7/12 Extract / Property Card': { title: '7/12 Extract / Property Card', body: 'The government land record (7/12 for land, Property Card for city plots) showing the owner and any loans or charges. Essential to verify who legally holds the land.' },
  'Encumbrance Certificate': { title: 'Encumbrance Certificate (EC)', body: 'Lists all registered loans, mortgages or claims on the property over a period. A clean EC assures buyers and banks that the property is free of dues.' },
  'Legal Title Search Report': { title: 'Legal Title Search Report', body: 'A lawyer\u2019s report confirming the title is clear and marketable. Banks often insist on it before sanctioning a home loan.' },

  // ---- Society ----------------------------------------------------------------
  'Society Registration Certificate': { title: 'Society Registration Certificate', body: 'Proof the housing society is legally registered. It establishes the body that issues your NOC and share certificate.' },
  'Society NOC': { title: 'Society NOC', body: 'A No-Objection Certificate confirming you have no pending dues and the society allows the sale/transfer. Buyers cannot complete a flat purchase without it.' },
  'Share Certificate': { title: 'Share Certificate', body: 'Proof you own shares in the housing society, i.e. membership tied to your flat. It is transferred to the buyer on sale.' },
  'Maintenance Receipt': { title: 'Maintenance Receipt', body: 'Shows society maintenance is paid up to date. It reassures buyers there are no outstanding society dues to inherit.' },

  // ---- Approvals & Plans ------------------------------------------------------
  'Sanctioned Building Plan': { title: 'Sanctioned Building Plan', body: 'The layout approved by the municipal authority. It proves the building was constructed legally and matches its permit.' },
  'Floor Plan': { title: 'Floor Plan', body: 'The layout of your specific unit. Helps buyers understand the space and confirm it matches what was sanctioned.' },
  'Commencement Certificate': { title: 'Commencement Certificate (CC)', body: 'Municipal permission to begin construction. Its absence signals an unauthorised build \u2014 a serious red flag for buyers.' },
  'Occupancy Certificate': { title: 'Occupancy Certificate (OC)', body: 'Certifies the building is complete, safe and legal to live in. Banks and buyers treat a missing OC as a major risk.' },
  'Completion Certificate': { title: 'Completion Certificate', body: 'Confirms construction finished as per the sanctioned plan. Often required alongside the OC for loans and resale.' },
  'RERA Certificate': { title: 'RERA Certificate', body: 'Registration under the Real Estate Regulatory Authority, holding the project accountable for carpet area, timelines and quality. A strong trust signal for buyers.' },
  'NA Order (Non-Agricultural)': { title: 'NA Order (Non-Agricultural)', body: 'Government order converting farmland to non-agricultural use. Without it, you cannot legally build a home on the plot.' },

  // ---- Purchase & Payments ----------------------------------------------------
  'Allotment Letter': { title: 'Allotment Letter', body: 'The builder\u2019s letter allotting a specific unit to you, with price and payment plan. Key evidence in an under-construction purchase.' },
  'Possession Letter': { title: 'Possession Letter', body: 'The builder\u2019s handover confirming the date you took possession. It marks when the property became yours to occupy.' },
  'Builder Payment Receipts': { title: 'Builder Payment Receipts', body: 'Proof of instalments paid to the builder. They establish your payment record and are needed for loan disbursal and resale.' },
  'Stamp Duty & Registration Receipt': { title: 'Stamp Duty & Registration Receipt', body: 'Proof you paid the state stamp duty and registration charges. Without it the sale is not legally registered.' },
  'Property Valuation Report': { title: 'Property Valuation Report', body: 'A valuer\u2019s estimate of the property\u2019s market worth. Banks use it to decide how much loan they will sanction.' },

  // ---- Tax & Utilities --------------------------------------------------------
  'Property Tax Receipt': { title: 'Property Tax Receipt', body: 'Shows municipal property tax is paid up to date. Buyers check it to confirm no tax arrears carry over.' },
  'Electricity Bill': { title: 'Electricity Bill', body: 'A recent paid bill doubles as address proof and shows utility dues are clear. Often asked for during KYC and transfers.' },

  // ---- Identity & KYC ---------------------------------------------------------
  'Aadhaar Card': { title: 'Aadhaar Card', body: 'Your primary government identity and address proof. Needed for rent agreements, ownership verification and most transactions.' },
  'PAN Card': { title: 'PAN Card', body: 'Your tax identity. Mandatory for property purchases above set limits, TDS, and any transaction the tax department tracks.' },
  'Passport Photo': { title: 'Passport Photo', body: 'A recent passport-size photograph required on agreements, registration forms and KYC.' },
  'Ownership Proof': { title: 'Ownership Proof', body: 'Proof you own the property you are letting out \u2014 the registered Index II, sale deed, or a recent electricity/property-tax bill. Required to register a rent agreement as the licensor.' },
};

export function docInfo(category) { return DOC_INFO[category] || null; }


// Home-loan checklist items (common docs required by banks)
export const HOME_LOAN_CHECKLIST = [
  'Sale Deed', 'Agreement to Sale', 'Index II', 'Encumbrance Certificate',
  'Property Tax Receipt', 'Society NOC', 'Sanctioned Building Plan',
  'Occupancy Certificate', 'RERA Certificate', 'Possession Letter',
];

const docsKey = (mobile) => `puneNestDocs:${mobile || 'anon'}`;
const docReqKey = (mobile) => `puneNestDocReq:${mobile || 'anon'}`;

function get(k, def) {
  try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch { return def; }
}
function set(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ }
  return v;
}

/* ---- Documents (keyed by property) ---- */
export function getAllDocs(mobile) { return get(docsKey(mobile), {}); }
export function getDocsForProp(mobile, propId) { return getAllDocs(mobile)[propId] || []; }

export function addDocument(mobile, propId, { category, name, size, mime, dataUrl }) {
  const all = getAllDocs(mobile);
  if (!all[propId]) all[propId] = [];
  const doc = {
    id: 'd' + Date.now(),
    category: category || 'Other',
    name: name || 'Document',
    size: size || 0,
    mime: mime || 'application/pdf',
    dataUrl: dataUrl || null,
    uploadedAt: Date.now(),
  };
  all[propId].unshift(doc);
  set(docsKey(mobile), all);
  return doc;
}

export function deleteDocument(mobile, propId, docId) {
  const all = getAllDocs(mobile);
  if (all[propId]) {
    all[propId] = all[propId].filter((d) => d.id !== docId);
    set(docsKey(mobile), all);
  }
  return all[propId] || [];
}

/* ---- Buyer Document Requests ---- */
export function getDocRequests(mobile) { return get(docReqKey(mobile), []); }
export function setDocRequests(mobile, reqs) { return set(docReqKey(mobile), reqs); }

export function addDocRequest(mobile, { propId, buyerName, buyerMobile, docType, acknowledgedDisclaimer }) {
  const reqs = getDocRequests(mobile);
  const existing = reqs.find((r) => r.propId === propId && r.buyerMobile === buyerMobile && r.docType === docType && r.status === 'pending');
  if (existing) return existing;
  const req = {
    id: 'req' + Date.now(),
    propId: propId || '',
    buyerName: buyerName || 'Buyer',
    buyerMobile: buyerMobile || '',
    docType: docType || 'Sale Deed',
    status: 'pending',
    requestedAt: Date.now(),
    acknowledgedDisclaimer: !!acknowledgedDisclaimer,
    ackAt: acknowledgedDisclaimer ? Date.now() : null,
  };
  reqs.unshift(req);
  setDocRequests(mobile, reqs);
  return req;
}

export function respondDocRequest(mobile, reqId, decision) {
  const reqs = getDocRequests(mobile);
  const req = reqs.find((r) => r.id === reqId);
  if (req) {
    req.status = decision === 'granted' ? 'granted' : 'declined';
    req.respondedAt = Date.now();
    // On grant, resolve which uploaded files the buyer may see: the actual documents
    // the owner uploaded for this property whose category matches the requested docType.
    // (The buyer requests by category; the owner uploads by category, so this is exact
    // scope — no separate "pick which docs" step needed.) Cleared on decline.
    if (req.status === 'granted') {
      req.sharedDocIds = getDocsForProp(mobile, req.propId)
        .filter((d) => d.category === req.docType)
        .map((d) => d.id);
    } else {
      req.sharedDocIds = [];
    }
    setDocRequests(mobile, reqs);
  }
  return req;
}

// Count of distinct uploaded files actually shared with a buyer across every granted
// request for one property. Lets the grant UI report an honest "N documents shared"
// (the owner may have granted a category they never uploaded a file for → 0).
export function countSharedDocs(ownerMobile, reqIds) {
  const reqs = getDocRequests(ownerMobile);
  const ids = new Set();
  (reqIds || []).forEach((id) => {
    const r = reqs.find((x) => x.id === id);
    if (r && r.status === 'granted') (r.sharedDocIds || []).forEach((d) => ids.add(d));
  });
  return ids.size;
}

// Notify the buyer that access was approved, with a one-tap link to the view-only
// viewer. Runs while the OWNER is signed in, so it writes to the buyer's own
// notification store (keyed by their mobile), deduped per buyer+property.
//
// Mock path only. Writing a row into somebody else's inbox is something only a server can do: the
// browser holding the owner's session has no authority over the buyer's notifications, and there is
// no endpoint that would let it try. The alternative — posting this through the notification
// service anyway — would either invent a cross-user endpoint that does not exist or, worse, file
// the buyer's notification into the *owner's* own inbox, which is the account the request would
// authenticate as. On live the grant itself is the server's event to announce, so the client stays
// out of it rather than guessing.
export function notifyBuyerDocsGranted(ownerMobile, reqIds) {
  if (isHttpDomain('notification')) return;
  const reqs = getDocRequests(ownerMobile);
  const granted = (reqIds || []).map((id) => reqs.find((x) => x.id === id)).filter((r) => r && r.status === 'granted');
  const first = granted[0];
  if (!first || !first.buyerMobile) return;
  pushNotificationFor(first.buyerMobile, {
    id: `docgrant-${digits(first.buyerMobile)}-${first.propId}`,
    type: 'document',
    title: 'Property documents unlocked',
    desc: 'The owner approved your request. Tap to view the shared documents (view-only).',
    link: `/view-documents?o=${digits(ownerMobile)}&r=${first.id}`,
  });
}

export function getPendingDocRequestCount(mobile) {
  return getDocRequests(mobile).filter((r) => r.status === 'pending').length;
}

/* ---- Checklist progress ---- */
/* Pure: derive the home-loan checklist from an already-loaded document list. It takes the docs
   rather than re-reading localStorage so a seam consumer (http or mock) can compute progress from
   what it fetched through `documentService` — the store is empty in http mode and would report a
   false 0/N (tech-debt D124 blocker 4). */
export function checklistFromDocs(docs) {
  const uploadedCategories = new Set((docs || []).map((d) => d.category));
  const ready = HOME_LOAN_CHECKLIST.filter((c) => uploadedCategories.has(c));
  return { ready: ready.length, total: HOME_LOAN_CHECKLIST.length, items: HOME_LOAN_CHECKLIST.map((c) => ({ name: c, done: uploadedCategories.has(c) })) };
}

/* Seed some demo document requests (first load) */
export function seedDocRequests(mobile, propId) {
  const reqs = getDocRequests(mobile);
  if (reqs.length > 0) return;
  const seeds = [
    { propId, buyerName: 'Priya Kulkarni', buyerMobile: '9876543210', docType: 'Sale Deed', status: 'pending', requestedAt: Date.now() - 86400000 },
    { propId, buyerName: 'Rohit More', buyerMobile: '9876543211', docType: 'Society NOC', status: 'pending', requestedAt: Date.now() - 172800000 },
  ];
  seeds.forEach((s, i) => { s.id = 'req' + (Date.now() + i); });
  setDocRequests(mobile, seeds);
}

/* ---- Format helpers ---- */
export function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

export function docIcon(mime) {
  if (/pdf/i.test(mime)) return 'file-text';
  if (/image/i.test(mime)) return 'image';
  return 'file';
}
