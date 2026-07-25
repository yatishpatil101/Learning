import { rawDb } from './internals.js';

// ---- Smart Dashboard Alerts ----
// Generates actionable intelligence alerts from live data.
// Each alert has: id, severity (critical|warning|info), category, title, body, cta, href.
export function computeSmartAlerts() {
  const db = rawDb();
  const listings = db.listings || [];
  const tickets = db.tickets || [];
  const users = db.users || [];
  const locs = db.localities || [];

  const now = Date.now();
  const alerts = [];

  // IDs are derived from category+severity to remain stable regardless of which alerts fire
  const push = (severity, category, title, body, href) => {
    alerts.push({ id: `SA-${category}-${severity}`, severity, category, title, body, href, at: new Date().toISOString() });
  };

  // --- 1. Stale listings (pending > 48 hours) ---
  const stale = listings.filter((l) => {
    if (l.status !== 'pending') return false;
    return (now - new Date(l.createdAt).getTime()) > 48 * 3600000;
  });
  if (stale.length >= 3) {
    push('critical', 'verification', `${stale.length} listings pending > 48 hours`, 'Review urgently — owners are waiting for their listings to go live.', '/admin/properties');
  } else if (stale.length > 0) {
    push('warning', 'verification', `${stale.length} listing${stale.length > 1 ? 's' : ''} awaiting review`, `Oldest pending since ${stale[0].createdAt}. Approve or reject to maintain SLA.`, '/admin/properties');
  }

  // --- 2. Unassigned service tickets ---
  const unassigned = tickets.filter((t) => !t.assignedTo && t.status !== 'done');
  const staleTickets = unassigned.filter((t) => (now - new Date(t.createdAt).getTime()) > 24 * 3600000);
  if (staleTickets.length > 0) {
    push('critical', 'services', `${staleTickets.length} ticket${staleTickets.length > 1 ? 's' : ''} unassigned > 24 hours`, `${staleTickets[0].service} for ${staleTickets[0].customer} waiting since ${staleTickets[0].createdAt}.`, '/admin/services');
  } else if (unassigned.length > 0) {
    push('warning', 'services', `${unassigned.length} unassigned service ticket${unassigned.length > 1 ? 's' : ''}`, 'Assign to staff to start fulfillment.', '/admin/services');
  }

  // --- 3. Owner onboarding stalled (concierge) ---
  const stalledOwners = listings.filter((l) => {
    if (!l.postedByAdmin || l.status !== 'pending') return false;
    const age = now - new Date(l.createdAt).getTime();
    return age > 72 * 3600000 && (!l.photosUploaded || !l.aadhaarVerified);
  });
  if (stalledOwners.length > 0) {
    const oldest = stalledOwners[0];
    const action = !oldest.photosUploaded ? 'uploaded photos' : 'completed Aadhaar verification';
    push('warning', 'concierge', `${stalledOwners.length} owner${stalledOwners.length > 1 ? 's' : ''} stalled on onboarding`, `${oldest.owner} hasn't ${action} in ${Math.round((now - new Date(oldest.createdAt).getTime()) / 86400000)} days — consider sending a reminder.`, '/admin/properties?tab=followup');
  }

  // --- 4. Supply-demand gap hotspots ---
  const supplyMap = {};
  listings.forEach((l) => {
    if (l.status === 'approved') supplyMap[l.locality] = (supplyMap[l.locality] || 0) + 1;
  });
  const hotLocalities = locs.filter((loc) => loc.demand >= 85 && (supplyMap[loc.name] || 0) <= 1);
  if (hotLocalities.length > 0) {
    const top = hotLocalities.sort((a, b) => b.demand - a.demand)[0];
    push('info', 'supply', `${hotLocalities.length} high-demand area${hotLocalities.length > 1 ? 's' : ''} under-served`, `${top.name} has demand index ${top.demand} but only ${supplyMap[top.name] || 0} listing${(supplyMap[top.name] || 0) !== 1 ? 's' : ''} — source more via concierge.`, '/admin/analytics?tab=supply-gap');
  }

  // --- 5. KYC backlog ---
  const kycPending = users.filter((u) => u.role === 'owner' && !u.verified);
  if (kycPending.length >= 10) {
    push('warning', 'kyc', `${kycPending.length} owners pending KYC verification`, 'Large backlog — prioritize active owners with listings.', '/admin/users');
  } else if (kycPending.length >= 5) {
    push('info', 'kyc', `${kycPending.length} owners awaiting KYC`, 'Verify to improve platform trust scores.', '/admin/users');
  }

  // --- 6. High-priority tickets in progress too long ---
  const longRunning = tickets.filter((t) => {
    if (t.status !== 'in_progress' || t.priority !== 'high') return false;
    return (now - new Date(t.createdAt).getTime()) > 5 * 86400000;
  });
  if (longRunning.length > 0) {
    push('warning', 'services-slow', `${longRunning.length} high-priority ticket${longRunning.length > 1 ? 's' : ''} running > 5 days`, `${longRunning[0].service} for ${longRunning[0].customer} — check for blockers.`, '/admin/services');
  }

  // --- 7. Flagged listings needing investigation ---
  const flagged = listings.filter((l) => l.status === 'flagged');
  if (flagged.length > 0) {
    push('warning', 'moderation', `${flagged.length} flagged listing${flagged.length > 1 ? 's' : ''} need investigation`, `Review reported content and take action.`, '/admin/properties');
  }

  // Sort: critical first, then warning, then info
  const order = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);

  return alerts;
}
