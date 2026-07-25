/* ---- Tab registry (consolidated). `owner` tabs only show once the user has real
   inventory (see Dashboard `isOwner`). `flag` tabs only show when the matching app
   feature flag is enabled, so a disabled feature never leaves a dead-end tab.

   The set was trimmed from 13 → 9 by grouping related sections behind sub-navs:
   - "My Properties" = Property Tools (old Owner Hub) + My Listings.
   - "Saved & Activity" = Saved + Recently Viewed + Alerts (+ followed societies).
   Legacy hashes still resolve via TAB_ALIAS below, so every deep-link keeps working. */
export const TABS = [
  { tab: 'overview', label: 'Overview', icon: 'layout-grid' },
  // Not owner-gated: Property Tools (Rent-o-meter) is the "value your home"
  // acquisition entry, reachable by any signed-in user (old /owner-hub route).
  { tab: 'properties', label: 'My Properties', icon: 'home' },
  // Tenant mirror of My Properties — "the home you rent". Shown to buyers/tenants
  // (and anyone with a finalised tenancy); a pure owner with no rental won't see it.
  { tab: 'rental', label: 'My Rental', icon: 'key-round', tenant: true },
  { tab: 'activity', label: 'Saved & Activity', icon: 'heart' },
  { tab: 'leads', label: 'Requests', icon: 'messages-square', owner: true },
  // Role-aware (like Documents): owners see a property P&L, tenants see the Rent
  // Wallet, and a user who is both can switch — so it's visible to everyone.
  { tab: 'finances', label: 'Finances', icon: 'wallet' },
  { tab: 'documents', label: 'Documents', icon: 'folder-lock' },
  { tab: 'visits', label: 'Scheduled Visits', icon: 'calendar-check' },
  // Messages has a single canonical layout — the full /messages inbox. The tab is
  // a link-out (see `link`) so the dashboard entry and the navbar icon open the
  // exact same inbox instead of a divergent preview.
  { tab: 'messages', label: 'Messages', icon: 'message-square', flag: 'inAppMessaging', link: '/messages' },
  // Account-level and universal (every user has a plan — buyers included), so it
  // lives in its own section rather than buried in Profile & Settings.
  { tab: 'billing', label: 'Plan & Billing', icon: 'receipt-indian-rupee' },
  { tab: 'profile', label: 'Profile & Settings', icon: 'user-cog' },
];

/* Back-compat: legacy tab hashes/?tab= values map onto the new tab (+ optional
   sub-section) so existing deep-links from across the app keep landing correctly.
   Resolution is render-only — the URL is left untouched (some flows, e.g. the
   /owner-hub redirect, assert the URL stays #owner-hub). */
export const TAB_ALIAS = {
  'owner-hub': { tab: 'properties' },
  listings: { tab: 'properties' },
  enquiries: { tab: 'leads' },
  saved: { tab: 'activity', sub: 'saved' },
  recent: { tab: 'activity', sub: 'recent' },
  alerts: { tab: 'activity', sub: 'alerts' },
  'my-rental': { tab: 'rental' },
  tenancy: { tab: 'rental' },
};

/* Static constants (moved to module scope to avoid per-render recreation) */
export const CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const CAL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const CAL_HOURS = Array.from({ length: 13 }, (_, i) => i + 7);
export const DOC_SALE = ['Sale Deed / Agreement', 'Index II', 'Property Tax Receipt', 'Encumbrance Certificate', 'Society NOC', 'Completion Certificate', 'Occupancy Certificate', 'Building Plan Approval'];
export const DOC_RENT = ['Index II / Ownership Proof', 'Electricity Bill', 'Owner Aadhaar', 'Maintenance Receipt'];
export const DOC_KYC = ['Aadhaar Card', 'PAN Card', 'Passport Photo'];
export const REVIEW_STATUS_MAP = {
  in_review: { label: 'Under Review', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/20', icon: 'clock' },
  pending: { label: 'Under Review', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/20', icon: 'clock' },
  clarification: { label: 'Action needed', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/20', icon: 'alert-circle' },
  verified: { label: 'Verified', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', icon: 'badge-check' },
  rejected: { label: 'Rejected', cls: 'text-gray-400 bg-white/5 border-white/10', icon: 'x-circle' },
};

export const SAVED_SEED = [
  { id: 'P5000', title: '3 BHK Flat, Baner', price: '₹1.25 Cr', bhk: '3 BHK', area: '1,850 sq.ft', img: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&q=80' },
  { id: 'P5008', title: '4 BHK Villa, Koregaon Park', price: '₹2.8 Cr', bhk: '4 BHK', area: '3,200 sq.ft', img: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&q=80' },
  { id: 'P5015', title: '4 BHK Penthouse, Kalyani Nagar', price: '₹3.5 Cr', bhk: '4 BHK', area: '4,500 sq.ft', img: 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=600&q=80' },
];


/* Visit request status for Enquiries tab */
export const VISIT_STATUS_CLS = {
  scheduled: 'bg-amber-500/15 text-amber-300',
  confirmed: 'bg-emerald-500/15 text-emerald-300',
  'no-show': 'bg-rose-500/15 text-rose-300',
  rescheduled: 'bg-indigo-500/15 text-indigo-300',
};

export const BILLING_HISTORY = [
  { id: 'INV-2041', plan: 'Owner plan (yearly)', amount: 999, at: '2026-01-14', status: 'Paid' },
  { id: 'INV-1980', plan: 'Featured listing', amount: 999, at: '2025-11-02', status: 'Paid' },
  { id: 'INV-1899', plan: 'Rent agreement', amount: 500, at: '2025-09-21', status: 'Paid' },
];
