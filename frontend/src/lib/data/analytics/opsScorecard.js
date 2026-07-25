import { rawDb, rng, iso, daysAgo } from './internals.js';

// ---- Daily Ops Scorecard ----
// Generates a snapshot of today's team performance with yesterday comparison.
// Uses deterministic simulation for consistency since mock data has date-level granularity.
export function dailyOpsScorecard() {
  const db = rawDb();
  const listings = db.listings || [];
  const tickets = db.tickets || [];
  const deals = db.deals || [];
  const staffActivity = Array.isArray(db.staffActivity) ? db.staffActivity : [];
  const r = rng(202607);

  const today = iso(new Date());
  const yesterday = iso(daysAgo(1));

  // Staff activity today/yesterday
  const activityToday = staffActivity.filter((a) => a.at && a.at.slice(0, 10) === today);
  const activityYesterday = staffActivity.filter((a) => a.at && a.at.slice(0, 10) === yesterday);

  // Listings processed (use createdAt to approximate approval activity)
  const pendingToday = listings.filter((l) => l.createdAt === today && l.status === 'pending').length;
  const approvedToday = listings.filter((l) => l.createdAt === today && l.status === 'approved').length;

  // Since mock data may not have today's entries, simulate realistic daily numbers
  const simToday = {
    listingsApproved: approvedToday || Math.round(2 + r() * 4),
    listingsRejected: Math.round(r() * 2),
    listingsPending: pendingToday || Math.round(1 + r() * 3),
    ticketsAssigned: tickets.filter((t) => t.assignedTo).length > 0 ? Math.round(2 + r() * 3) : 0,
    ticketsCompleted: Math.round(1 + r() * 3),
    ticketsOpen: tickets.filter((t) => t.status === 'new' || t.status === 'in_progress').length,
    remindersSent: activityToday.filter((a) => a.action === 'owner-reminder').length || Math.round(r() * 4),
    conciergePosted: activityToday.filter((a) => a.action === 'post-on-behalf').length || Math.round(r() * 2),
    enquiriesResponded: Math.round(3 + r() * 6),
    dealsToday: deals.filter((d) => d.at === today).length || Math.round(r() * 2),
    revenueToday: Math.round((15000 + r() * 35000) / 100) * 100,
    staffActive: new Set(activityToday.map((a) => a.staffName)).size || Math.round(3 + r() * 4),
    totalActions: activityToday.length || Math.round(12 + r() * 18),
  };

  // Yesterday comparison (simulated slightly lower for growth narrative)
  const simYesterday = {
    listingsApproved: Math.round(simToday.listingsApproved * (0.7 + r() * 0.4)),
    listingsRejected: Math.round(simToday.listingsRejected * (0.6 + r() * 0.5)),
    listingsPending: Math.round(simToday.listingsPending * (0.8 + r() * 0.4)),
    ticketsAssigned: Math.round(simToday.ticketsAssigned * (0.7 + r() * 0.4)),
    ticketsCompleted: Math.round(simToday.ticketsCompleted * (0.6 + r() * 0.5)),
    ticketsOpen: simToday.ticketsOpen + Math.round(r() * 3),
    remindersSent: Math.round(simToday.remindersSent * (0.5 + r() * 0.6)),
    conciergePosted: Math.round(simToday.conciergePosted * (0.6 + r() * 0.5)),
    enquiriesResponded: Math.round(simToday.enquiriesResponded * (0.7 + r() * 0.4)),
    dealsToday: Math.round(simToday.dealsToday * (0.5 + r() * 0.6)),
    revenueToday: Math.round((simToday.revenueToday * (0.6 + r() * 0.5)) / 100) * 100,
    staffActive: Math.round(simToday.staffActive * (0.7 + r() * 0.4)),
    totalActions: Math.round(simToday.totalActions * (0.7 + r() * 0.4)),
  };

  // Daily targets
  const targets = {
    listingsApproved: 5,
    ticketsCompleted: 4,
    enquiriesResponded: 8,
    remindersSent: 3,
    totalActions: 25,
  };

  // Staff breakdown today (top performers)
  const staffMap = {};
  activityToday.forEach((a) => {
    if (!staffMap[a.staffName]) staffMap[a.staffName] = { name: a.staffName, team: a.staffTeam || '', count: 0 };
    staffMap[a.staffName].count++;
  });
  // If no real activity, simulate
  const staffBreakdown = Object.values(staffMap).length > 0
    ? Object.values(staffMap).sort((a, b) => b.count - a.count).slice(0, 5)
    : [
        { name: 'Kabir Iyer', team: 'rental', count: Math.round(4 + r() * 5) },
        { name: 'Tanvi Rao', team: 'interior', count: Math.round(3 + r() * 4) },
        { name: 'Meera Mehta', team: 'legal', count: Math.round(2 + r() * 4) },
        { name: 'Karan Chavan', team: 'valuation', count: Math.round(2 + r() * 3) },
      ];

  return {
    date: today,
    today: simToday,
    yesterday: simYesterday,
    targets,
    staffBreakdown,
  };
}
