import ExcelJS from 'exceljs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'tasks', 'code-freeze-checklist.xlsx');

const consumer = [
  ['Home', '/', 'Hero search, categories, featured, recently-viewed, activity ticker, testimonials, FAQ, CTA, flatmates section'],
  ['Listings', '/listings', 'Filters, filter drawer (mobile), sort, map view (?view=map), cards, save, notify-me, pagination/empty'],
  ['Property detail', '/property/:id', 'Gallery, floor plan, rent details, price insights, owner card, contact modal, schedule-visit modal, reviews, report, similar, compare toggle, deal panel, verification'],
  ['Owner profile', '/owner/:id', 'Owner info, listings by owner, contact'],
  ['Compare', '/compare', 'Add/remove properties, side-by-side table, flag-gated'],
  ['Signin', '/signin', 'Login validation, error states, redirect after login'],
  ['Signup', '/signup', 'Registration, validation, flag-gated (signupsEnabled)'],
  ['Staff Login', '/staff-login', 'Admin vs Ops+team selection, correct redirect'],
  ['Services hub', '/services', 'Service cards link to correct sub-pages'],
  ['Packers & Movers', '/services/packers-movers', 'Form/quote flow, auth-gated'],
  ['Property Legal', '/services/property-legal', 'Request flow, auth-gated'],
  ['Home Loans', '/home-loans', 'Loan info/lead form, auth-gated'],
  ['Interior & Renovation', '/services/interior-renovation', 'Request flow, auth-gated'],
  ['Property Valuation', '/services/property-valuation', 'Valuation request, auth-gated'],
  ['Rent Agreement', '/services/rent-agreement', 'Multi-step wizard (owner→tenant→property→terms→witnesses→review), doc upload, cost sidebar, auth-gated'],
  ['Contact', '/contact', 'Form submit, validation'],
  ['Notifications', '/notifications', 'List, mark read, empty state, auth-gated'],
  ['Plans', '/plans', 'Plan cards, CTA to checkout'],
  ['Refer', '/refer', 'Referral code, share, auth-gated'],
  ['EMI Calculator', '/emi-calculator', 'Sliders/inputs, calc correctness, chart, flag-gated'],
  ['Tenant Profile', '/tenant-profile', 'Profile edit/save, auth-gated'],
  ['Checkout', '/checkout', 'Order summary, pay flow (mock), auth-gated'],
  ['Schedule Visit', '/schedule-visit', 'Date/time picker, submit, flag+auth-gated'],
  ['Society', '/society', 'Society SaaS landing, flag-gated'],
  ['Reels', '/reels', 'Video/reel scroll, autoplay, controls'],
  ['Saved', '/saved', 'Saved list, remove, empty state, flag+auth-gated'],
  ['Pay Rent', '/pay-rent', 'Static coming-soon page; no payment rail behind it'],
  ['Locality', '/locality, /locality/:slug', 'Locality list + detail, insights, links'],
  ['Messages', '/messages', 'Threads, send message, flag+auth-gated'],
  ['Flatmates', '/flatmates', 'Search/filter, room/seeker/group cards, post modal, verify modal, map'],
  ['Support', '/support', 'Ticket list, new ticket form, thread modal, FAQ, lightbox, auth-gated'],
  ['View Documents', '/view-documents/:requestId', 'Secure full-screen viewer (own chrome), auth-gated; the grant id in the path is the whole address — no owner mobile, no token'],
  ['List Property', '/list-property', '3-step wizard (details→location/pricing→photos/docs), map picker, paywall, progress, auth-gated'],
  ['Dashboard', '/dashboard', 'Panels: overview, my-listings, saved, recent, enquiries, messages, billing, alerts, docs; auth-gated'],
  ['Privacy', '/privacy', 'Static content renders'],
  ['Terms', '/terms', 'Static content renders'],
  ['Refund Policy', '/refund-policy', 'Static content renders'],
  ['Disclaimer', '/disclaimer', 'Static content renders'],
  ['404 / Not Found', '*', 'Stub renders, link back home'],
];

const admin = [
  ['Dashboard', '/admin', 'Daily scorecard, SLA health, smart alerts panels'],
  ['Properties', '/admin/properties', 'Verification queue, review modal, doc viewer, WhatsApp templates, comms log, pipeline tab, approve/reject'],
  ['Analytics', '/admin/analytics', 'All tabs: traffic, surfers, supply-gap, SLA, seasonal, pricing, geography, engagement, conversion; charts render; flag-gated'],
  ['Users', '/admin/users', 'List, filter, detail, role/status actions'],
  ['Services', '/admin/services', 'Service requests mgmt (incl. merged Support)'],
  ['Enquiries', '/admin/enquiries', 'List, funnel view, status updates'],
  ['Finance', '/admin/finance', 'Revenue/txn tables, charts, flag-gated'],
  ['Content', '/admin/content', 'CMS content edit/publish'],
  ['Reports (Trust & Safety)', '/admin/reports', 'Report queue, actions, flag-gated'],
  ['Flatmates', '/admin/flatmates', 'Flatmate moderation, flag-gated'],
  ['Settings', '/admin/settings', 'Admin flags panel, app flags panel, save persists'],
  ['Post on Behalf', '/admin/post-on-behalf', 'Wizard steps to create listing for an owner'],
  ['Staff Activity', '/admin/staff-activity', 'Activity log, filters'],
  ['Support redirect', '/admin/support', 'Redirects to /admin/services'],
];

const ops = [
  ['Dashboard', '/ops', 'Team-scoped overview, queues summary'],
  ['Requests', '/ops/requests', 'Shared queue, ticket detail, status/stepper'],
  ['Rent Agreement', '/ops/rent-agreement', 'Queue + doc viewer, team-gated (rental)'],
  ['Legal', '/ops/legal', 'Queue, team-gated (legal)'],
  ['Interior', '/ops/interior', 'Queue, team-gated (interior)'],
  ['Packers', '/ops/packers', 'Queue, team-gated (packers)'],
  ['Valuation', '/ops/valuation', 'Queue, team-gated (valuation)'],
  ['Referrals', '/ops/referrals', 'Fraud-review queue, approve/reject'],
];

const global = [
  ['Navbar', 'links, active state, city switcher, auth menu, mobile hamburger drawer'],
  ['Footer', 'all links resolve (Privacy, Terms, Refund, Disclaimer, Contact, Support)'],
  ['Routing', 'no dead routes; 404 (*) renders Stub; /map → /listings?view=map redirect'],
  ['Auth guards', 'ProtectedRoute bounces logged-out users to signin; RoleRoute/TeamRoute block wrong roles'],
  ['Feature flags', 'AppFlagRoute/FlagRoute correctly hide/show (compare, signup, emiCalculator, etc.)'],
  ['ScrollToTop', 'top-of-page on navigation; back/forward restores scroll'],
  ['Toasts', 'success/error toasts fire and dismiss'],
  ['Loading fallback', 'lazy-route spinner shows, no layout jump'],
  ['Formatting', 'Currency/number/date formatting consistent (lib/format.js)'],
  ['localStorage mock API', 'CRUD persists across reload (draazyDB_v1)'],
  ['Responsive breakpoints', '360 / 414 / 768 / 1024 / 1280 all clean'],
  ['Accessibility', 'focus rings, alt text, aria on icon-only buttons, modal focus trap'],
  ['Console/network', 'zero uncaught errors, no 404 assets across a full click-through'],
];

const wb = new ExcelJS.Workbook();
wb.creator = 'Draazy QA';
wb.created = new Date();

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
const SECTION_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = border;
  });
  row.height = 22;
}

function buildPageSheet(name, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Page', key: 'page', width: 24 },
    { header: 'Route', key: 'route', width: 26 },
    { header: 'Key functions to test', key: 'fn', width: 60 },
    { header: '[1] Improve/Feature', key: 'c1', width: 16 },
    { header: '[2] Mobile', key: 'c2', width: 16 },
    { header: '[3] Freeze QA', key: 'c3', width: 16 },
    { header: 'Notes / Bugs', key: 'notes', width: 40 },
  ];
  styleHeader(ws.getRow(1));
  rows.forEach((r) => {
    const row = ws.addRow({ page: r[0], route: r[1], fn: r[2], c1: '', c2: '', c3: '', notes: '' });
    row.eachCell((cell, col) => {
      cell.border = border;
      cell.alignment = { vertical: 'top', wrapText: true, horizontal: col >= 4 && col <= 6 ? 'center' : 'left' };
    });
  });
  // Data validation dropdown for status columns
  const statusList = '"To do,In progress,Done,Bug"';
  for (let r = 2; r <= rows.length + 1; r++) {
    ['D', 'E', 'F'].forEach((c) => {
      ws.getCell(`${c}${r}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: [statusList],
      };
    });
  }
  return ws;
}

// Global sheet
const gws = wb.addWorksheet('Global', { views: [{ state: 'frozen', ySplit: 1 }] });
gws.columns = [
  { header: 'Item', key: 'item', width: 24 },
  { header: 'What to verify', key: 'detail', width: 70 },
  { header: 'Status', key: 'status', width: 16 },
  { header: 'Notes / Bugs', key: 'notes', width: 40 },
];
styleHeader(gws.getRow(1));
global.forEach((r) => {
  const row = gws.addRow({ item: r[0], detail: r[1], status: '', notes: '' });
  row.eachCell((cell, col) => {
    cell.border = border;
    cell.alignment = { vertical: 'top', wrapText: true, horizontal: col === 3 ? 'center' : 'left' };
  });
});
for (let r = 2; r <= global.length + 1; r++) {
  gws.getCell(`C${r}`).dataValidation = {
    type: 'list', allowBlank: true, formulae: ['"To do,In progress,Done,Bug"'],
  };
}

buildPageSheet('Consumer', consumer);
buildPageSheet('Admin', admin);
buildPageSheet('Ops', ops);

// Bug log sheet
const bws = wb.addWorksheet('Bug Log');
bws.columns = [
  { header: '#', key: 'n', width: 6 },
  { header: 'Page', key: 'page', width: 24 },
  { header: 'Severity', key: 'sev', width: 14 },
  { header: 'Description', key: 'desc', width: 60 },
  { header: 'Status', key: 'status', width: 16 },
];
styleHeader(bws.getRow(1));
for (let i = 1; i <= 30; i++) {
  const row = bws.addRow({ n: i, page: '', sev: '', desc: '', status: '' });
  row.eachCell((cell) => { cell.border = border; cell.alignment = { vertical: 'top', wrapText: true }; });
  bws.getCell(`C${i + 1}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Critical,High,Medium,Low"'] };
  bws.getCell(`E${i + 1}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Open,In progress,Fixed,Won\'t fix"'] };
}

await wb.xlsx.writeFile(outPath);
console.log('Wrote', outPath);
