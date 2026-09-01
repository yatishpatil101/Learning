/* Pure derivations for the consumer Dashboard. No React, no side effects — every
   function takes the container's already-loaded state and returns display data,
   so the container stays a thin orchestrator and this logic is testable in
   isolation. Behaviour is identical to the previous inline computations. */

// Group buyer document requests per buyer+property (one due-diligence request =
// one lead). Mirrors the previous inline useMemo body exactly.
export function buildDocGroups(docReqs) {
  const map = new Map();
  for (const r of docReqs) {
    const key = (r.buyerMobile || '') + '|' + (r.propId || '');
    let g = map.get(key);
    if (!g) { g = { buyerName: r.buyerName || 'A buyer', propId: r.propId || '', docTypes: [], pendingIds: [], requestedAt: Infinity }; map.set(key, g); }
    if (r.docType) g.docTypes.push(r.docType);
    if (r.status === 'pending') g.pendingIds.push(r.id);
    const t = r.requestedAt || 0;
    if (t && t < g.requestedAt) g.requestedAt = t;
  }
  return [...map.values()];
}

// The single "what's waiting on ME" triage list. Every row is a real
// request/task; sorted stale-first so the oldest, most-at-risk items lead.
export function buildActionItems({
  isOwner, contactReqs, apps, photoReqs, pendingDocGroups, listings, reviewsByProp,
  scheduledVisits, rental, payEnabledRent,
  decideContact, decideApp, go, decideDocReqs, resolvePhotoReq, navigate,
}) {
  const actionItems = [];
  if (isOwner) {
    contactReqs.filter((r) => r.status === 'pending').forEach((r) => {
      actionItems.push({
        id: 'contact:' + r.id, tone: 'rose', icon: 'lock-keyhole',
        title: `${r.buyerName || 'A buyer'} wants your phone number`,
        sub: r.propId ? 'Listing ' + r.propId : 'Number request',
        at: r.requestedAt || null,
        actions: [
          { label: 'Share', icon: 'check', onClick: () => decideContact(r.id, 'approved') },
          { label: 'Decline', icon: 'x', variant: 'ghost', onClick: () => decideContact(r.id, 'declined') },
        ],
      });
    });
    apps.filter((a) => a.status === 'pending').forEach((a) => {
      actionItems.push({
        id: 'app:' + a.id, tone: 'teal', icon: 'users-round',
        title: `Group wants to rent ${a.listingTitle || 'your flat'}`,
        sub: `${a.groupTitle || 'Flatmate group'} · ${a.members}/${a.seatsTotal} members`,
        at: a.at || null,
        actions: [
          { label: 'Accept', icon: 'check', onClick: () => decideApp(a.id, 'accepted') },
          { label: 'Decline', icon: 'x', variant: 'ghost', onClick: () => decideApp(a.id, 'declined') },
        ],
      });
    });
    /* Filtered to pending, unlike before: every other row in this list disappears once the owner
       has dealt with it, and a photo request that could never leave was the one row teaching people
       that the Action Center does not empty. "Mark done" is what makes the filter reachable. */
    photoReqs.filter((r) => (r.status || 'pending') === 'pending').forEach((r) => {
      actionItems.push({
        id: 'photo:' + r.id, tone: 'amber', icon: 'image',
        title: `${r.buyerName || 'A buyer'} asked for more photos`,
        sub: r.propLabel || (r.propId ? 'Listing ' + r.propId : 'Photo request'),
        at: r.requestedAt || null,
        actions: [
          { label: 'Add photos', icon: 'image', onClick: () => go('leads') },
          ...(resolvePhotoReq ? [{ label: 'Mark done', icon: 'check', variant: 'ghost', onClick: () => resolvePhotoReq(r.id) }] : []),
        ],
      });
    });
    pendingDocGroups.forEach((g) => {
      const n = g.docTypes.length;
      const propTitle = listings.find((l) => l.id === g.propId)?.title || (g.propId ? 'Listing ' + g.propId : 'Document request');
      actionItems.push({
        id: 'doc:' + g.propId + ':' + (g.buyerName || ''), tone: 'teal', icon: 'folder-check',
        title: `${g.buyerName} wants ${g.pendingIds.length} document${g.pendingIds.length === 1 ? '' : 's'}`,
        sub: propTitle,
        at: g.requestedAt === Infinity ? null : g.requestedAt,
        actions: [
          { label: 'Grant all', icon: 'check', onClick: () => decideDocReqs(g.pendingIds, 'granted') },
          { label: 'Decline', icon: 'x', variant: 'ghost', onClick: () => decideDocReqs(g.pendingIds, 'declined') },
        ],
      });
    });
    // "Ops is waiting on you" used to be a `clarification` status this file read straight out of
    // localStorage. The server's review has no such status — what it has is a thread, and the
    // honest signal is an unread message from ops. Same rule as the listing card's chip, and it
    // reads the summaries the container already loaded rather than opening a second data source.
    listings.filter((l) => !l.flatmate && (reviewsByProp?.[l.id]?.unread || 0) > 0).forEach((l) => {
      const rev = reviewsByProp[l.id];
      actionItems.push({
        id: 'clarify:' + l.id, tone: 'rose', icon: 'alert-circle',
        title: `Action needed on "${l.title}"`,
        sub: 'PuneNest verification needs more info',
        at: rev?.updatedAt || null,
        actions: [{ label: 'Respond', icon: 'arrow-right', onClick: () => go('properties') }],
      });
    });
  }
  // Shared: upcoming visits still awaiting confirmation (owner and seeker both act here).
  scheduledVisits.forEach((v) => {
    actionItems.push({
      id: 'visit:' + v.id, tone: 'indigo', icon: 'calendar-check',
      title: `Visit to confirm${v.listing ? ' — ' + v.listing : ''}`,
      sub: [v.customer, v.when].filter(Boolean).join(' · ') || 'Scheduled visit',
      at: v.at || v.createdAt || null,
      actions: [{ label: 'Review', icon: 'arrow-right', onClick: () => go('visits') }],
    });
  });
  // Seeker/tenant: rent due on a tracked rental (same honest gate as the nudge card).
  if (!isOwner && rental) {
    actionItems.push({
      id: 'rent:' + (rental.id || 'due'), tone: 'amber', icon: 'bell',
      title: 'Rent due soon',
      sub: `${rental.title || 'Your rental'} · due ${rental.dueDay || 5}th`,
      at: null, atText: `due ${rental.dueDay || 5}th`,
      actions: payEnabledRent
        ? [{ label: 'Pay now', icon: 'arrow-right', onClick: () => navigate('/pay-rent') }]
        : [{ label: 'Coming soon', variant: 'ghost', onClick: () => navigate('/pay-rent') }],
    });
  }
  const STALE_MS = 2 * 86400000;
  actionItems.sort((a, b) => {
    const aStale = a.at && Date.now() - a.at > STALE_MS ? 1 : 0;
    const bStale = b.at && Date.now() - b.at > STALE_MS ? 1 : 0;
    if (aStale !== bStale) return bStale - aStale;
    return (a.at || Infinity) - (b.at || Infinity);
  });
  return actionItems;
}

/* Owner Overview stat cards — real figures from the user's own listings + leads.

   That sentence used to be half true. The third tile counted `enquiries`, which was a slice of
   fixture rows nothing in the app ever wrote, so an owner with no activity at all was still shown
   a headline "8 Enquiries". It now counts the same leads the Leads panel lists — number requests,
   photo requests, document requests and flatmate requests — which is why the caller passes one
   `leadCount` rather than the arrays: the tile and the panel must not be able to disagree. */
export function buildOwnerStats({ listings, totalViews, leadCount, pendingContacts, go }) {
  return [
    { icon: 'building-2', bg: 'bg-teal-400/15', fg: 'text-teal-400', value: String(listings.length), label: 'Active Listings', trend: { dir: 'flat', text: listings.length ? `${listings.length} total` : 'None yet' }, onClick: () => go('properties'), ariaLabel: 'View my properties' },
    { icon: 'eye', bg: 'bg-teal-400/15', fg: 'text-teal-400', value: totalViews.toLocaleString('en-IN'), label: 'Total Views', trend: { dir: 'flat', text: `across ${listings.length} listing${listings.length === 1 ? '' : 's'}` }, onClick: () => go('properties'), ariaLabel: 'View my properties' },
    { icon: 'messages-square', bg: 'bg-amber-400/15', fg: 'text-amber-400', value: String(leadCount), label: 'Leads', trend: { dir: leadCount ? 'up' : 'flat', text: leadCount ? `${leadCount} total` : 'None yet' }, onClick: () => go('enquiries'), ariaLabel: 'View enquiries and requests' },
    { icon: 'lock-keyhole', bg: 'bg-red-400/15', fg: 'text-red-400', value: String(pendingContacts), label: 'Number Requests', trend: { dir: pendingContacts ? 'up' : 'flat', text: pendingContacts ? `${pendingContacts} pending` : 'All handled' }, onClick: () => go('enquiries'), ariaLabel: 'View number requests' },
  ];
}

// Seeker Overview stat cards — real figures from the user's saved/viewed stores.
export function buildSeekerStats({ savedCount, recent, alertCount, followCount, go }) {
  return [
    { icon: 'heart', bg: 'bg-red-400/15', fg: 'text-red-400', value: String(savedCount), label: 'Saved Properties', trend: { dir: 'flat', text: savedCount ? 'Tap Saved to view' : 'None yet' }, onClick: () => go('saved'), ariaLabel: 'View saved properties' },
    { icon: 'history', bg: 'bg-teal-400/15', fg: 'text-teal-400', value: String(recent.length), label: 'Recently Viewed', trend: { dir: 'flat', text: recent.length ? 'Continue exploring' : 'Start browsing' }, onClick: () => go('recent'), ariaLabel: 'View recently viewed properties' },
    { icon: 'bell-plus', bg: 'bg-teal-400/15', fg: 'text-teal-400', value: String(alertCount), label: 'Saved Searches', trend: { dir: 'flat', text: alertCount ? 'Alerts active' : 'Create one' }, onClick: () => go('alerts'), ariaLabel: 'View saved searches and alerts' },
    { icon: 'building-2', bg: 'bg-amber-400/15', fg: 'text-amber-400', value: String(followCount), label: 'Followed Societies', trend: { dir: 'flat', text: followCount ? 'Tap Alerts to view' : 'Follow buildings' }, onClick: () => go('alerts'), ariaLabel: 'View followed societies' },
  ];
}
