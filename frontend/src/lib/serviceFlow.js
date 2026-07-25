/* ==========================================================================
   PuneNest — Service request workflow engine (ESM port of service-workflow.js)
   Shared between consumer service pages and the ops back-office. State lives in
   localStorage under `puneNestServiceReq:<userMobileDigits>` (identical keys to
   the HTML app) so the same request is read/written by customer and staff.
   ========================================================================== */
import { logStaffActivity, syncServiceTicket } from './mockApi.js';
import { pushNotificationFor } from './store.js';

const PREFIX = 'puneNestServiceReq:';
const INV_PREFIX = 'puneNestRAInvite:';

export function digits(m) { return String(m == null ? '' : m).replace(/\D/g, ''); }
const key = (m) => PREFIX + (digits(m) || 'anon');
const load = (m) => { try { return JSON.parse(localStorage.getItem(key(m))) || []; } catch { return []; } };
const save = (m, arr) => localStorage.setItem(key(m), JSON.stringify(arr));
const invKey = (m) => INV_PREFIX + (digits(m) || 'anon');
const loadInv = (m) => { try { return JSON.parse(localStorage.getItem(invKey(m))) || []; } catch { return []; } };
const saveInv = (m, arr) => localStorage.setItem(invKey(m), JSON.stringify(arr));

/* Unguessable token — the co-fill invite id is a bearer token in a WhatsApp deep link,
   so it must not be enumerable. Falls back to a random string on very old browsers. */
const randToken = () => {
  try {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && c.randomUUID) return c.randomUUID().replace(/-/g, '');
    if (c && c.getRandomValues) {
      const a = new Uint8Array(16); c.getRandomValues(a);
      return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* ignore */ }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
};

export const STEPS = ['Submitted', 'Documents', 'Draft & approval', 'Registration', 'Ready'];
const ACTIVE = { awaiting_party: 0, submitted: 1, docs_review: 1, draft_shared: 2, changes_requested: 2, approved: 3, registration: 3, completed: 4, cancelled: 0 };
const LABEL = {
  awaiting_party: 'Awaiting the other party',
  submitted: 'Request submitted', docs_review: 'Documents under review',
  draft_shared: 'Draft shared for your review', changes_requested: 'Changes requested',
  approved: 'Draft approved — awaiting registration', registration: 'Submitted for government registration',
  completed: 'Registered — ready to download', cancelled: 'Cancelled',
};
export const activeStep = (status) => (ACTIVE[status] == null ? 0 : ACTIVE[status]);
export const stepStates = (status) => {
  if (status === 'completed') return STEPS.map(() => 'done');
  const a = activeStep(status);
  return STEPS.map((_, i) => (i < a ? 'done' : i === a ? 'active' : 'todo'));
};
export const statusLabel = (status) => LABEL[status] || status;
export const isActive = (status) => status !== 'completed' && status !== 'cancelled';

// Percent-complete for the status tile bar. Derived from the same STEPS/ACTIVE map so it stays
// in sync with the stepper: Submitted 25% → Draft 50% → Registration 75% → Ready 100%.
// awaiting_party sits at the start (0%); cancelled has no meaningful progress (null → no bar).
export const progressPct = (status) => {
  if (status === 'cancelled') return null;
  if (status === 'completed') return 100;
  return Math.round((activeStep(status) / (STEPS.length - 1)) * 100);
};

export const STATUS_META = {
  awaiting_party: { label: 'Waiting for the other party', color: '#fcd34d', bg: 'rgba(245,158,11,.2)', icon: 'hourglass' },
  submitted: { label: 'Submitted', color: '#a5b4fc', bg: 'rgba(99,102,241,.2)', icon: 'inbox' },
  docs_review: { label: 'Documents under review', color: '#fcd34d', bg: 'rgba(245,158,11,.2)', icon: 'folder-check' },
  draft_shared: { label: 'Draft ready for your review', color: '#5eead4', bg: 'rgba(20,184,166,.2)', icon: 'file-pen-line' },
  changes_requested: { label: 'Changes requested', color: '#fda4af', bg: 'rgba(244,63,94,.2)', icon: 'rotate-ccw' },
  approved: { label: 'Approved — awaiting registration', color: '#5eead4', bg: 'rgba(20,184,166,.2)', icon: 'check' },
  registration: { label: 'In government registration', color: '#fcd34d', bg: 'rgba(245,158,11,.2)', icon: 'landmark' },
  completed: { label: 'Registered & ready', color: '#6ee7b7', bg: 'rgba(16,185,129,.2)', icon: 'badge-check' },
  cancelled: { label: 'Cancelled', color: '#9ca3af', bg: 'rgba(148,163,184,.2)', icon: 'x-circle' },
};
export const statusMeta = (s) => STATUS_META[s] || { label: 'In progress', color: '#d1d5db', bg: 'rgba(255,255,255,.1)', icon: 'loader' };

function defaultDocs() {
  return [
    { id: 'd_oid', name: 'Owner Aadhaar + PAN', status: 'submitted', note: '' },
    { id: 'd_tid', name: 'Tenant Aadhaar + PAN', status: 'submitted', note: '' },
    { id: 'd_own', name: 'Ownership proof (Index II / tax receipt)', status: 'submitted', note: '' },
    { id: 'd_photo', name: 'Passport photos (all parties)', status: 'submitted', note: '' },
    { id: 'd_bill', name: 'Latest electricity bill', status: 'submitted', note: '' },
  ];
}
function tl(r, stage, by, note) { r.timeline = r.timeline || []; r.timeline.push({ stage, at: Date.now(), by: by || '', note: note || '' }); }

function sampleDocFile(label, sub) {
  const e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let lines = '';
  for (let i = 0; i < 9; i++) { const w = 360 - (i % 4) * 40; lines += `<rect x="70" y="${240 + i * 46}" width="${w}" height="12" rx="6" fill="#d7d9e0"/>`; }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">' +
    '<rect width="600" height="800" fill="#eceef3"/>' +
    '<rect x="40" y="40" width="520" height="720" rx="10" fill="#ffffff" stroke="#d2d5dd"/>' +
    '<rect x="40" y="40" width="520" height="86" rx="10" fill="#0d9488"/>' +
    `<text x="70" y="94" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#ffffff">${e(label)}</text>` +
    `<text x="70" y="170" font-family="Arial, sans-serif" font-size="15" fill="#6b7280">${e(sub || 'Uploaded by customer · sample document')}</text>` +
    '<rect x="400" y="150" width="120" height="150" rx="8" fill="#f1f2f6" stroke="#d2d5dd"/>' +
    '<text x="460" y="232" font-family="Arial, sans-serif" font-size="12" fill="#9ca3af" text-anchor="middle">PHOTO</text>' +
    lines +
    '<text x="70" y="720" font-family="Arial, sans-serif" font-size="12" fill="#9ca3af">PuneNest — document preview (prototype sample)</text>' +
    '</svg>';
  return { fileName: label.replace(/[^a-z0-9]+/gi, '-') + '.svg', dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), mime: 'image/svg+xml' };
}
export { sampleDocFile };
function demoDocs() {
  return [
    { id: 'd_oid', name: 'Owner Aadhaar + PAN', status: 'submitted', note: '', file: sampleDocFile('Owner Aadhaar + PAN', 'KYC document') },
    { id: 'd_tid', name: 'Tenant Aadhaar + PAN', status: 'submitted', note: '', file: sampleDocFile('Tenant Aadhaar + PAN', 'KYC document') },
    { id: 'd_own', name: 'Ownership proof (Index II / tax receipt)', status: 'submitted', note: '', file: sampleDocFile('Ownership Proof', 'Index II / tax receipt') },
    { id: 'd_photo', name: 'Passport photos (all parties)', status: 'submitted', note: '', file: sampleDocFile('Passport Photos', 'All parties') },
    { id: 'd_bill', name: 'Latest electricity bill', status: 'submitted', note: '', file: sampleDocFile('Electricity Bill', 'Latest utility bill') },
  ];
}

export const list = (m) => load(m);
export const get = (m, id) => load(m).filter((x) => x.id === id)[0] || null;

export const create = (m, data) => {
  data = data || {};
  const arr = load(m);
  const r = {
    id: 'SR' + Date.now() + Math.floor(Math.random() * 100),
    type: data.type || 'rental', service: data.service || 'Rent Agreement',
    status: 'submitted',
    customer: { name: (data.customer && data.customer.name) || 'Customer', mobile: digits(m) },
    details: data.details || {}, docs: data.docs || defaultDocs(),
    draft: null, draftDecision: null, finalDoc: null, messages: [], timeline: [],
    ticketRef: data.ticketRef || null,
    assignedTo: null, createdAt: Date.now(), updatedAt: Date.now(),
  };
  tl(r, 'submitted', 'Customer', 'Request submitted via website.');
  r.messages.push({ from: 'staff', text: 'Thanks! Your ' + (r.service || 'service') + ' request is received. Our team will review it and update you here shortly.', at: Date.now(), read: false });
  arr.unshift(r); save(m, arr); return r;
};
// Mirror the real ops workflow state onto the linked admin service-ticket so AdminServices,
// OpsDashboard and analytics never show a request stuck at "new" after it has moved on.
// Only requests created with a ticketRef sync (all service quote forms that open an ops
// flow — legal, packers, valuation, interior, rent-agreement — now stamp one); everything
// else no-ops.
const TICKET_STATUS = {
  awaiting_party: 'new', submitted: 'new', docs_review: 'in_progress',
  draft_shared: 'in_progress', changes_requested: 'in_progress', approved: 'in_progress',
  registration: 'in_progress', completed: 'done', cancelled: 'cancelled',
};
const syncTicket = (r) => {
  if (!r || !r.ticketRef) return;
  try { syncServiceTicket(r.ticketRef, TICKET_STATUS[r.status] || 'in_progress'); } catch { /* ignore */ }
};
const _save = (m, r) => {
  const arr = load(m); const ids = arr.map((x) => x.id); const i = ids.indexOf(r.id);
  r.updatedAt = Date.now();
  if (i >= 0) arr[i] = r; else arr.unshift(r);
  save(m, arr); syncTicket(r); return r;
};
export const update = (m, id, patch) => { const r = get(m, id); if (!r) return null; Object.keys(patch).forEach((k) => { r[k] = patch[k]; }); return _save(m, r); };
export const assign = (m, id, name) => {
  const r = update(m, id, { assignedTo: name });
  if (r) logStaffActivity({ action: r.service || 'service', category: 'service', detail: `Assigned "${r.service}" for ${r.customer?.name || m}`, meta: { requestId: id, service: r.service } });
  return r;
};

export const setDocStatus = (m, id, docId, status, note) => {
  const r = get(m, id); if (!r) return null;
  (r.docs || []).forEach((d) => { if (d.id === docId) { d.status = status; if (note != null) d.note = note; } });
  return _save(m, r);
};
export const markDocsVerified = (m, id, by) => {
  const r = get(m, id); if (!r) return null;
  (r.docs || []).forEach((d) => { if (d.status !== 'rejected') d.status = 'verified'; });
  if (r.status === 'submitted') { r.status = 'docs_review'; tl(r, 'docs_review', by || 'Staff', 'Documents verified.'); }
  return _save(m, r);
};
export const addMessage = (m, id, from, text) => {
  text = String(text || '').trim(); if (!text) return get(m, id);
  const r = get(m, id); if (!r) return null;
  r.messages.push({ id: 'm' + Date.now(), from, text, at: Date.now(), read: false });
  return _save(m, r);
};
export const markRead = (m, id, who) => {
  const r = get(m, id); if (!r) return null;
  const want = who === 'staff' ? 'user' : 'staff';
  r.messages.forEach((x) => { if (x.from === want) x.read = true; });
  return _save(m, r);
};
export const unread = (m, id, who) => {
  const r = get(m, id); if (!r) return 0;
  const want = who === 'staff' ? 'user' : 'staff';
  return (r.messages || []).filter((x) => x.from === want && !x.read).length;
};
export const setStatus = (m, id, status, by, note) => { const r = get(m, id); if (!r) return null; r.status = status; tl(r, status, by, note); return _save(m, r); };

/* Cross-user dashboard bell notification for a maker-checker transition, so neither
   party has to remember to reopen the tracker. Rental updates deep-link to the tracker
   (where Approve / Download live); other services to the dashboard. */
const custLink = (r) => (r && r.type === 'rental' ? '/services/rent-agreement' : '/dashboard');
const notify = (mobile, id, title, desc, link) => {
  try { pushNotificationFor(mobile, { id, type: 'service', title, desc, link }); } catch { /* ignore */ }
};

export const shareDraft = (m, id, file, by) => {
  const r = get(m, id); if (!r) return null;
  const ver = ((r.draft && r.draft.version) || 0) + 1;
  r.draft = { fileName: file.fileName, dataUrl: file.dataUrl || '', sharedAt: Date.now(), version: ver };
  r.draftDecision = null; r.status = 'draft_shared';
  tl(r, 'draft_shared', by || 'Staff', 'Draft v' + ver + ' shared with customer.');
  r.messages.push({ from: 'staff', text: "We've shared the draft agreement (v" + ver + ') for your review. Please approve it, or request changes.', at: Date.now(), read: false });
  notify(r.customer?.mobile, 'svc_draft_' + r.id, (r.service || 'Service') + ' draft ready to review',
    'Your ' + (r.service || 'request') + ' draft (v' + ver + ') is ready. Review and approve it so we can proceed with registration.', custLink(r));
  return _save(m, r);
};
export const decideDraft = (m, id, type, note) => {
  const r = get(m, id); if (!r) return null;
  r.draftDecision = { type, note: note || '', at: Date.now() };
  if (type === 'accepted') {
    r.status = 'approved'; tl(r, 'approved', 'Customer', 'Draft approved.');
    r.messages.push({ from: 'user', text: 'I approve the draft. Please proceed with registration.', at: Date.now(), read: false });
  } else {
    r.status = 'changes_requested'; tl(r, 'changes_requested', 'Customer', note || 'Changes requested.');
    r.messages.push({ from: 'user', text: 'Please make these changes before we proceed: ' + (note || '(no details provided)'), at: Date.now(), read: false });
  }
  return _save(m, r);
};
export const submitRegistration = (m, id, by) => {
  const r = get(m, id); if (!r) return null;
  r.status = 'registration'; tl(r, 'registration', by || 'Staff', 'Submitted for e-registration at the Sub-Registrar office.');
  r.messages.push({ from: 'staff', text: "Your agreement has been submitted for government e-registration. We'll upload the registered copy here once it's available.", at: Date.now(), read: false });
  notify(r.customer?.mobile, 'svc_reg_' + r.id, (r.service || 'Service') + ' submitted for registration',
    'Your ' + (r.service || 'request') + ' has been submitted for government e-registration. We\'ll notify you the moment the registered copy is ready.', custLink(r));
  return _save(m, r);
};
export const uploadFinal = (m, id, file, by) => {
  const r = get(m, id); if (!r) return null;
  r.finalDoc = { fileName: file.fileName, dataUrl: file.dataUrl || '', uploadedAt: Date.now() };
  r.status = 'completed'; tl(r, 'completed', by || 'Staff', 'Final document uploaded.');
  r.messages.push({ from: 'staff', text: '🎉 Your ' + (r.service || 'request') + ' is complete! You can download the final document from your dashboard.', at: Date.now(), read: false });
  notify(r.customer?.mobile, 'svc_done_' + r.id, (r.service || 'Service') + ' is registered & ready',
    'Great news — your ' + (r.service || 'request') + ' is registered. Download the final document from your dashboard.', custLink(r));
  logStaffActivity({ action: r.service || 'service', category: 'service', detail: `Completed "${r.service}" for ${r.customer?.name || m}`, meta: { requestId: id, service: r.service } });
  return _save(m, r);
};
export const cancel = (m, id, by, note) => setStatus(m, id, 'cancelled', by || 'Staff', note || 'Request cancelled.');

export const allRequests = (typeFilter) => {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) {
        const mob = k.slice(PREFIX.length); let arr = [];
        try { arr = JSON.parse(localStorage.getItem(k)) || []; } catch { /* ignore */ }
        arr.forEach((r) => {
          if (!typeFilter || r.type === typeFilter) { const c = JSON.parse(JSON.stringify(r)); c._mobile = mob; out.push(c); }
        });
      }
    }
  } catch { /* ignore */ }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
};
export const openCount = (typeFilter) => allRequests(typeFilter).filter((r) => isActive(r.status)).length;

const _docsFor = (names) => names.map((n, i) => ({ id: 'd' + i + '_' + n.replace(/[^a-z0-9]+/gi, '').slice(0, 8).toLowerCase(), name: n, status: 'submitted', note: '', file: sampleDocFile(n, 'Uploaded by customer') }));

export const seedService = (type) => {
  if (allRequests(type).length) return;
  const CFG = {
    legal: { service: 'Property & Legal', team: 'Legal Team', docs: ['Sale deed / title document', 'Encumbrance certificate', 'Property tax receipts', 'Owner KYC (Aadhaar + PAN)', 'Approved building plan'], reqs: [
      { mob: '9811101010', name: 'Nikhil Patil', advance: 'docs', details: { service: 'Sale Deed Drafting & Registration', role: 'Seller', location: 'Mundhwa, Pune', note: 'Selling plot — need sale deed drafting and Sub-Registrar registration support.', property: 'Plot 22, Mundhwa, Pune', ownerName: 'Nikhil Patil', buyer: 'Sana Shaikh', value: 9500000, area: '2400 sq.ft', purpose: 'Title verification + sale registration' } },
      { mob: '9811102020', name: 'Meera Iyer', advance: null, details: { service: 'Title Search & Due Diligence', role: 'Buyer', location: 'Wakad, Pune', note: 'Verifying title before buying resale flat — 30-year search please.', property: 'C-101, Lake County, Wakad', ownerName: 'Meera Iyer', buyer: '—', value: 7200000, area: '1150 sq.ft', purpose: 'Title due-diligence' } },
    ] },
    interior: { service: 'Interior & Renovation', team: 'Interior Team', docs: ['Floor plan / layout', 'Site photos', 'Requirements brief', 'Society renovation NOC'], reqs: [
      { mob: '9822201010', name: 'Sahil Verma', advance: 'draft', details: { property: 'B-904, Orchid Square, Hinjawadi', scope: 'Full home interiors', rooms: '3 BHK', budget: 850000, timeline: '8 weeks' } },
      { mob: '9822202020', name: 'Priya Nair', advance: null, details: { property: 'A-12, Rowhouse, Bavdhan', scope: 'Modular kitchen + wardrobes', rooms: 'Kitchen + 2 BR', budget: 320000, timeline: '4 weeks' } },
    ] },
    packers: { service: 'Packers & Movers', team: 'Packers Team', docs: ['Inventory / item list', 'ID proof', 'Society gate pass', 'Parking permission'], reqs: [
      { mob: '9833301010', name: 'Rohan Gupta', advance: 'docs', details: { from: 'Baner, Pune', to: 'Kharadi, Pune', moveDate: '2026-07-05', homeSize: '2 BHK', floors: '5th → 3rd (lifts both)', quote: 18000 } },
      { mob: '9833302020', name: 'Anjali Rao', advance: null, details: { from: 'Wakad, Pune', to: 'Hadapsar, Pune', moveDate: '2026-06-29', homeSize: '3 BHK', floors: '2nd → 7th', quote: 26000 } },
    ] },
    valuation: { service: 'Property Valuation', team: 'Valuation Team', docs: ['Ownership proof (Index II)', 'Property photos', 'Layout / floor plan', 'Latest tax receipt'], reqs: [
      { mob: '9844401010', name: 'Deepak Shah', advance: 'docs', details: { property: 'F-305, Sun Residency, Aundh', ptype: 'Apartment', area: '1320 sq.ft', purpose: 'Bank loan valuation', estValue: 11000000 } },
      { mob: '9844402020', name: 'Kavita Menon', advance: null, details: { property: 'Bungalow 7, NIBM Road', ptype: 'Bungalow', area: '3100 sq.ft', purpose: 'Sale advisory', estValue: 24500000 } },
    ] },
  };
  const cfg = CFG[type]; if (!cfg) return;
  cfg.reqs.forEach((q) => {
    const r = create(q.mob, { type, service: cfg.service, customer: { name: q.name }, docs: _docsFor(cfg.docs), details: q.details });
    if (q.advance === 'docs' || q.advance === 'draft') setStatus(q.mob, r.id, 'docs_review', 'System', 'Auto-routed to the ' + cfg.team + '.');
    if (q.advance === 'draft') { markDocsVerified(q.mob, r.id, 'System'); shareDraft(q.mob, r.id, { fileName: cfg.service.replace(/[^a-z0-9]+/gi, '-') + '-proposal.pdf', dataUrl: sampleDocFile(cfg.service + ' proposal', 'Prepared by PuneNest').dataUrl, mime: 'image/svg+xml' }, cfg.team); }
  });
};

export const seedDemo = () => {
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(PREFIX) === 0) return; }
  const m1 = '9820011223';
  const r1 = create(m1, { type: 'rental', service: 'Rent Agreement', customer: { name: 'Rahul Deshpande' }, docs: demoDocs(), details: { property: 'B-1204, Skyline Heights, Baner, Pune', ownerName: 'Rahul Deshpande', tenants: 'Sneha Kulkarni', rent: 32000, deposit: 150000, months: '11', startDate: '2026-07-01', regArea: 'Municipal / Urban' } });
  setStatus(m1, r1.id, 'docs_review', 'System', 'Auto-routed to the Rent Agreement team.');
  const m2 = '9876502341';
  create(m2, { type: 'rental', service: 'Rent Agreement', customer: { name: 'Aarti Joshi' }, docs: demoDocs(), details: { property: 'A-302, Green Meadows, Wakad, Pune', ownerName: 'Aarti Joshi', tenants: 'Vikram Rao, Pooja Rao', rent: 24000, deposit: 100000, months: '11', startDate: '2026-06-25', regArea: 'Municipal / Urban' } });
  const m3 = '9833114477';
  const r3 = create(m3, { type: 'rental', service: 'Rent Agreement', customer: { name: 'Karan Mehta' }, docs: demoDocs(), details: { property: 'F-707, Aster Residency, Kharadi, Pune', ownerName: 'Karan Mehta', tenants: 'Riya Sharma', rent: 36000, deposit: 180000, months: '11', startDate: '2026-07-10', regArea: 'Municipal / Urban' } });
  markDocsVerified(m3, r3.id, 'System');
  shareDraft(m3, r3.id, { fileName: 'Draft-RentAgreement-v1.pdf', dataUrl: sampleDocFile('Draft Agreement', 'Leave & License draft').dataUrl, mime: 'image/svg+xml' }, 'Rent Agreement Team');
  decideDraft(m3, r3.id, 'accepted');
  submitRegistration(m3, r3.id, 'Rent Agreement Team');
  seedService('legal'); seedService('interior'); seedService('packers'); seedService('valuation');
};

export const makeSampleRequest = (mobile, name) => {
  const r = create(mobile, {
    type: 'rental', service: 'Rent Agreement', customer: { name: name || 'You' }, docs: demoDocs(),
    details: { property: 'A-1203, Demo Residency, Baner, Pune', ownerName: name || 'You', tenants: 'Sample Tenant', rent: 28000, deposit: 140000, months: '11', startDate: '2026-08-01', regArea: 'Municipal / Urban' },
  });
  markDocsVerified(mobile, r.id, 'Rent Agreement Team');
  shareDraft(mobile, r.id, { fileName: 'Draft-RentAgreement-v1.pdf', dataUrl: sampleDocFile('Leave & License Draft', 'Prepared by PuneNest — review & approve').dataUrl, mime: 'image/svg+xml' }, 'Rent Agreement Team');
  return get(mobile, r.id);
};

/* ---- Co-fill: split a rent agreement between owner & tenant by mobile ---- */
export const createCoFill = (ownerMobile, data) => {
  data = data || {};
  const arr = load(ownerMobile);
  const r = {
    id: 'SR' + Date.now() + Math.floor(Math.random() * 100),
    type: data.type || 'rental', service: data.service || 'Rent Agreement',
    status: 'awaiting_party',
    customer: { name: (data.customer && data.customer.name) || 'Owner', mobile: digits(ownerMobile) },
    details: data.details || {}, docs: data.docs || [],
    draft: null, draftDecision: null, finalDoc: null, messages: [], timeline: [],
    parties: data.parties || [],
    coFill: { initiatorRole: data.initiatorRole || '', pendingRole: '', inviteId: '' },
    ticketRef: data.ticketRef || null,
    assignedTo: null, createdAt: Date.now(), updatedAt: Date.now(),
  };
  const toRole = (data.invite && data.invite.toRole) || 'other party';
  tl(r, 'awaiting_party', data.initiatorName || 'Customer', 'Started a co-fill rent agreement and invited the ' + toRole + ' to complete their details.');
  arr.unshift(r); save(ownerMobile, arr);
  let inv = null;
  if (data.invite && digits(data.invite.toMobile)) inv = createInvite(ownerMobile, r.id, data.invite);
  return { req: r, invite: inv };
};
export const createInvite = (reqMobile, reqId, info) => {
  info = info || {};
  const toM = digits(info.toMobile); if (!toM) return null;
  const invId = 'INV' + randToken();
  const rec = {
    inviteId: invId, reqMobile: digits(reqMobile), reqId,
    fromName: info.fromName || 'A PuneNest user', fromRole: info.fromRole || '',
    toMobile: toM, toName: info.toName || '', toRole: info.toRole || '',
    sections: info.sections || [], property: info.property || '',
    message: info.message || '', status: 'pending', createdAt: Date.now(),
  };
  const listA = loadInv(toM); listA.unshift(rec); saveInv(toM, listA);
  const r = get(reqMobile, reqId);
  if (r) { r.coFill = r.coFill || {}; r.coFill.pendingRole = rec.toRole; r.coFill.inviteId = invId; _save(reqMobile, r); }
  return rec;
};
export const listInvites = (mobile) => loadInv(mobile);
export const pendingInvites = (mobile) => loadInv(mobile).filter((x) => x.status === 'pending');
export const pendingInviteCount = (mobile) => pendingInvites(mobile).length;

/* In-app (relative) path the invited party opens to fill their section. Safe for
   React Router <Link>/notification links, which only accept same-origin paths. */
export const invitePath = (inviteId) => '/services/rent-agreement?invite=' + encodeURIComponent(inviteId || '');
/* Absolute deep link (origin + path) for external channels like WhatsApp. */
export const inviteLink = (inviteId, origin) => {
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  return base + invitePath(inviteId);
};
/* WhatsApp deep link that actually delivers a co-fill invite to the tenant/owner.
   Mirrors the app-wide wa.me/91<digits>?text=… pattern. */
export const buildInviteWaLink = (info, origin) => {
  info = info || {};
  const to = digits(info.toMobile);
  const link = inviteLink(info.inviteId, origin);
  const from = info.fromName || 'A PuneNest user';
  const property = info.property ? ` for ${info.property}` : '';
  const role = info.toRole || 'tenant';
  const note = info.message ? `\n\n"${info.message}"` : '';
  const text = `Hi${info.toName ? ' ' + info.toName : ''}, ${from} has started a Rent Agreement${property} on PuneNest and needs you (as ${role}) to add your details & documents.${note}\n\nComplete your part here: ${link}`;
  return `https://wa.me/${to ? '91' + to : ''}?text=${encodeURIComponent(text)}`;
};

export const getInvite = (mobile, invId) => loadInv(mobile).filter((x) => x.inviteId === invId)[0] || null;
/* Resolve an invite by its id alone, without knowing whose mobile it lives under.
   The invite id in the WhatsApp deep link is a bearer token, so an invitee can open
   it before signing in — scan every `puneNestRAInvite:*` bucket to find it. */
export const findInviteById = (invId) => {
  if (!invId || typeof localStorage === 'undefined') return null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(INV_PREFIX) !== 0) continue;
      let arr = [];
      try { arr = JSON.parse(localStorage.getItem(k)) || []; } catch { arr = []; }
      const hit = arr.find((x) => x && x.inviteId === invId);
      if (hit) return hit;
    }
  } catch { /* ignore */ }
  return null;
};
export const inviteContext = (mobile, invId) => {
  const inv = getInvite(mobile, invId); if (!inv) return null;
  return { invite: inv, req: get(inv.reqMobile, inv.reqId) };
};
const _setInviteStatus = (mobile, invId, status, extra) => {
  const listA = loadInv(mobile);
  listA.forEach((x) => { if (x.inviteId === invId) { x.status = status; if (extra) Object.keys(extra).forEach((k) => { x[k] = extra[k]; }); } });
  saveInv(mobile, listA);
};
export const submitInviteDetails = (mobile, invId, partialDetails, docs, party) => {
  const inv = getInvite(mobile, invId); if (!inv) return null;
  const r = get(inv.reqMobile, inv.reqId); if (!r) return null;
  partialDetails = partialDetails || {};
  r.details = r.details || {};
  Object.keys(partialDetails).forEach((k) => { if (partialDetails[k] != null && partialDetails[k] !== '') r.details[k] = partialDetails[k]; });
  if (docs && docs.length) r.docs = (r.docs || []).concat(docs);
  party = party || {};
  r.parties = r.parties || [];
  let found = false;
  r.parties.forEach((p) => { if (p.role === inv.toRole) { found = true; if (party.name) p.name = party.name; if (party.mobile) p.mobile = digits(party.mobile); } });
  if (!found && inv.toRole) r.parties.push({ role: inv.toRole, mobile: digits(mobile), name: party.name || '' });
  if (inv.toRole === 'owner' && party.name) r.customer.name = party.name;
  r.coFill = r.coFill || {}; r.coFill.pendingRole = '';
  r.status = 'submitted';
  tl(r, 'submitted', party.name || 'Customer', 'Completed the ' + (inv.toRole || 'remaining') + ' details. Request submitted for processing.');
  r.messages.push({ from: 'staff', text: 'Thanks! Both parties have completed their details. Your Rent Agreement request is received — our team will review it and update you here shortly.', at: Date.now(), read: false });
  _save(inv.reqMobile, r);
  notify(r.customer?.mobile, 'svc_party_' + r.id, (party.name || 'The other party') + ' completed their details',
    (party.name || 'The invited ' + (inv.toRole || 'party')) + ' has completed their part of your Rent Agreement' + (r.details?.property ? ' for ' + r.details.property : '') + '. It\'s now with our team for processing.', custLink(r));
  _setInviteStatus(mobile, invId, 'filled', { filledAt: Date.now() });
  return r;
};
export const declineInvite = (mobile, invId, note) => {
  const inv = getInvite(mobile, invId); if (!inv) return null;
  _setInviteStatus(mobile, invId, 'declined', { note: note || '' });
  const r = get(inv.reqMobile, inv.reqId);
  if (r) {
    r.coFill = r.coFill || {}; r.coFill.declined = true;
    tl(r, 'awaiting_party', inv.toName || 'Invited party', 'Declined the request to complete their details' + (note ? ': ' + note : '.'));
    r.messages.push({ from: 'staff', text: 'The ' + (inv.toRole || 'other party') + ' declined the request to complete their part' + (note ? ' (' + note + ')' : '') + '. You can resend the invite or fill in their details yourself.', at: Date.now(), read: false });
    _save(inv.reqMobile, r);
  }
  return inv;
};
export const listForParty = (mobile) => {
  const md = digits(mobile);
  return allRequests().filter((r) => digits(r._mobile) === md || (r.parties || []).some((p) => digits(p.mobile) === md));
};
