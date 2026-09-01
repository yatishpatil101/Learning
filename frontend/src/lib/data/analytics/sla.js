import { rawDb, rng } from './internals.js';

// ---- SLA Indicators ----
// Tracks internal ops team performance on tasks PuneNest owns:
// 1. Listing approval speed (pending → approved/rejected)
// 2. Service fulfillment speed (ticket created → done)
// 3. Concierge pipeline speed (posted-on-behalf → live)
// 4. Support/ticket pickup speed (ticket created → assigned)
export function slaMetrics() {
  const db = rawDb();
  const listings = db.listings || [];
  const tickets = db.tickets || [];
  const r = rng(314159);

  // SLA targets
  const SLA = {
    listingApproval: 24,   // approve/reject listing within 24 hours
    servicePickup: 4,      // assign service ticket within 4 hours
    serviceDelivery: 72,   // complete service within 72 hours (3 days)
    conciergeToLive: 168,  // concierge listing goes live within 7 days (168 hours)
  };

  // --- 1. Listing Approval SLA ---
  // Measure: how quickly pending listings get reviewed
  const now = Date.now();
  const pendingListings = listings.filter((l) => l.status === 'pending');
  const reviewedListings = listings.filter((l) => l.status === 'approved' || l.status === 'rejected');

  // Simulate review time deterministically for reviewed listings
  const approvalMetrics = reviewedListings.map((l) => {
    const hoursToApprove = Math.round((2 + r() * 30) * 10) / 10; // 2-32 hours
    return { id: l.id, title: l.title, hoursToApprove, breached: hoursToApprove > SLA.listingApproval };
  });

  // Pending listings: compute how long they've been waiting
  const pendingWait = pendingListings.map((l) => {
    const created = new Date(l.createdAt).getTime();
    const hoursWaiting = Math.round((now - created) / 3600000);
    return { id: l.id, title: l.title, hoursWaiting, breaching: hoursWaiting > SLA.listingApproval };
  });

  const approvalBreaches = approvalMetrics.filter((a) => a.breached).length;
  const currentlyBreaching = pendingWait.filter((p) => p.breaching).length;
  const avgApprovalTime = approvalMetrics.length
    ? +(approvalMetrics.reduce((s, a) => s + a.hoursToApprove, 0) / approvalMetrics.length).toFixed(1)
    : 0;
  const approvalSlaRate = approvalMetrics.length
    ? Math.round(((approvalMetrics.length - approvalBreaches) / approvalMetrics.length) * 100)
    : 100;

  // --- 2. Service Pickup SLA ---
  // Measure: how quickly tickets get assigned to a staff member
  const assignedTickets = tickets.filter((t) => t.assignedTo);
  const unassignedTickets = tickets.filter((t) => !t.assignedTo);

  const pickupMetrics = assignedTickets.map((t) => {
    const hoursToPickup = Math.round((0.5 + r() * 6) * 10) / 10; // 0.5-6.5 hours
    return { id: t.id, service: t.service, hoursToPickup, breached: hoursToPickup > SLA.servicePickup };
  });

  const pickupBreaches = pickupMetrics.filter((p) => p.breached).length;
  const avgPickupTime = pickupMetrics.length
    ? +(pickupMetrics.reduce((s, p) => s + p.hoursToPickup, 0) / pickupMetrics.length).toFixed(1)
    : 0;
  const pickupSlaRate = pickupMetrics.length
    ? Math.round(((pickupMetrics.length - pickupBreaches) / pickupMetrics.length) * 100)
    : 100;

  // --- 3. Service Delivery SLA ---
  // Measure: how quickly tickets go from creation to done
  const doneTickets = tickets.filter((t) => t.status === 'done');
  const inProgressTickets = tickets.filter((t) => t.status === 'in_progress');

  const deliveryMetrics = doneTickets.map((t) => {
    const hoursToDeliver = Math.round((12 + r() * 80) * 10) / 10; // 12-92 hours
    return { id: t.id, service: t.service, customer: t.customer, hoursToDeliver, breached: hoursToDeliver > SLA.serviceDelivery };
  });

  const deliveryBreaches = deliveryMetrics.filter((d) => d.breached).length;
  const avgDeliveryTime = deliveryMetrics.length
    ? +(deliveryMetrics.reduce((s, d) => s + d.hoursToDeliver, 0) / deliveryMetrics.length).toFixed(1)
    : 0;
  const deliverySlaRate = deliveryMetrics.length
    ? Math.round(((deliveryMetrics.length - deliveryBreaches) / deliveryMetrics.length) * 100)
    : 100;

  // --- 4. Concierge Pipeline SLA ---
  // Measure: how quickly staff-posted listings go live.
  //
  // "Live" is `status === 'approved'` and nothing else (D27). This used to also test
  // `pipelineStage === 'live'`, which was dead against the API — `live` was never one of the
  // server's stages, so the first half of the test could only ever match a listing whose stage had
  // been written by the old browser-local console. V92 removed the value entirely; the status test
  // was already carrying the whole clause.
  const conciergeListings = listings.filter((l) => l.postedByAdmin);
  const liveConc = conciergeListings.filter((l) => l.status === 'approved');
  const pendingConc = conciergeListings.filter((l) => l.status !== 'approved');

  const conciergeMetrics = liveConc.map((l) => {
    const hoursToLive = Math.round((48 + r() * 150) * 10) / 10; // 48-198 hours
    return { id: l.id, title: l.title, hoursToLive, breached: hoursToLive > SLA.conciergeToLive };
  });

  const conciergeBreaches = conciergeMetrics.filter((c) => c.breached).length;
  const avgConciergeTime = conciergeMetrics.length
    ? +(conciergeMetrics.reduce((s, c) => s + c.hoursToLive, 0) / conciergeMetrics.length).toFixed(1)
    : 0;
  const conciergeSlaRate = conciergeMetrics.length
    ? Math.round(((conciergeMetrics.length - conciergeBreaches) / conciergeMetrics.length) * 100)
    : 100;

  // --- Aggregate summary ---
  const totalBreaches = approvalBreaches + pickupBreaches + deliveryBreaches + conciergeBreaches;
  const rates = [approvalSlaRate, pickupSlaRate, deliverySlaRate, conciergeSlaRate];
  const overallSlaRate = Math.round(rates.reduce((s, r) => s + r, 0) / rates.length);

  // Weekly trend (simulated, 4 weeks)
  const weeklyTrend = [
    { week: 'W1', approval: 78 + Math.round(r() * 12), pickup: 80 + Math.round(r() * 12), delivery: 70 + Math.round(r() * 15), concierge: 65 + Math.round(r() * 20) },
    { week: 'W2', approval: 80 + Math.round(r() * 12), pickup: 82 + Math.round(r() * 10), delivery: 73 + Math.round(r() * 14), concierge: 68 + Math.round(r() * 18) },
    { week: 'W3', approval: 82 + Math.round(r() * 10), pickup: 85 + Math.round(r() * 10), delivery: 76 + Math.round(r() * 13), concierge: 72 + Math.round(r() * 16) },
    { week: 'W4', approval: 85 + Math.round(r() * 10), pickup: 87 + Math.round(r() * 8), delivery: 78 + Math.round(r() * 12), concierge: 75 + Math.round(r() * 15) },
  ];

  return {
    targets: SLA,
    summary: {
      avgApprovalTime,
      approvalBreaches,
      approvalSlaRate,
      currentlyBreaching,
      avgPickupTime,
      pickupBreaches,
      pickupSlaRate,
      unassignedCount: unassignedTickets.length,
      avgDeliveryTime,
      deliveryBreaches,
      deliverySlaRate,
      inProgressCount: inProgressTickets.length,
      avgConciergeTime,
      conciergeBreaches,
      conciergeSlaRate,
      pendingConcierge: pendingConc.length,
      totalBreaches,
      overallSlaRate,
    },
    weeklyTrend,
  };
}
