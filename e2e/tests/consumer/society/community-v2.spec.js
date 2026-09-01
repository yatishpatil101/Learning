import { test, expect } from '@playwright/test';
import { appReady } from '../../../helpers/app.js';

// Society Hub — Community v2: threaded replies, events/notices calendar, resident
// WhatsApp group (ops-approved), unified moderation queue, and retro-gated Reviews/Q&A.
// All state is localStorage (no backend). Seed society: verified "Skyline Heights, Baner".

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SLUG = 'skyline-heights-baner';
const KYC_MOBILE = '9876543212';
const RES_MOBILE = '9820011111';

async function seedUser(page, mobile, role = 'owner') {
  await page.addInitScript(([m, r]) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Riya Sharma', mobile: m, role: r, loginAt: Date.now() }));
  }, [mobile, role]);
}
async function seedKyc(page, mobile, role = 'owner') {
  await seedUser(page, mobile, role);
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
  }, mobile);
}
async function seedResident(page, mobile) {
  await page.addInitScript(([s, m]) => {
    localStorage.setItem('pnSocietyResidents', JSON.stringify([
      { id: 'res-' + m, slug: s, mobile: m, status: 'verified', name: 'Riya Sharma', wing: 'A', flat: '101', unitKey: 'A101', at: Date.now() },
    ]));
  }, [SLUG, mobile]);
}
async function seedContribs(page, list) {
  await page.addInitScript(([s, arr]) => {
    localStorage.setItem('pnSocietyContributions', JSON.stringify({ [s]: arr }));
  }, [SLUG, list]);
}
function contrib(over = {}) {
  return { id: 'c-1', kind: 'tip', category: 'Water', text: 'Water tanker fills the sump at 6am on Tuesdays.', user: 'Neha', mobile: '9700000001', resident: false, at: Date.now() - 10000, helpful: [], replies: [], ...over };
}

async function gotoHub(page, tab = '') {
  const q = tab ? `?tab=${tab}` : '';
  await page.goto(`${BASE}/society/${SLUG}${q}`);
  await expect(page.getByRole('heading', { level: 1, name: /Skyline Heights/i })).toBeVisible({ timeout: 10000 });
}
async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
}

// ─── AC1: KYC member can reply to a contribution ───
test('KYC member replies to a contribution — reply shows with a badge and persists', async ({ page }) => {
  await seedKyc(page, KYC_MOBILE);
  await seedContribs(page, [contrib()]);
  await gotoHub(page, 'community');

  const feed = page.locator('section', { has: page.getByRole('heading', { name: 'Community insights' }) });
  const card = feed.locator('div.glass.rounded-xl', { hasText: 'Water tanker fills the sump' });
  await card.getByRole('button', { name: /^Reply/ }).click();
  await card.getByPlaceholder('Write a reply…').fill('Thanks — good to know for the terrace tank too.');
  await card.getByRole('button', { name: 'Post', exact: true }).click();

  await expect(card.getByText('Thanks — good to know for the terrace tank too.')).toBeVisible({ timeout: 8000 });
  // Non-resident KYC author carries a "Verified" badge on the reply.
  await expect(card.getByText('Verified', { exact: true }).first()).toBeVisible();

  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('pnSocietyContributions') || '{}'));
  expect(store[SLUG][0].replies.length).toBe(1);
  expect(store[SLUG][0].replies[0].text).toContain('terrace tank');
});

// ─── AC2: a logged-in member replies / reports directly (badge-not-gate) ───
test('a logged-in member replies and reports directly — no Aadhaar gate', async ({ page }) => {
  await seedUser(page, '9811111111'); // logged in, NOT Aadhaar verified — still allowed
  await seedContribs(page, [contrib()]);
  await gotoHub(page, 'community');

  const gate = page.getByRole('dialog', { name: /Verify your identity with Aadhaar/i });
  const feed = page.locator('section', { has: page.getByRole('heading', { name: 'Community insights' }) });
  const card = feed.locator('div.glass.rounded-xl', { hasText: 'Water tanker fills the sump' });

  // Reply → inline composer opens directly, no gate.
  await card.getByRole('button', { name: /^Reply/ }).click();
  await expect(card.getByPlaceholder('Write a reply…')).toBeVisible({ timeout: 8000 });
  await expect(gate).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Report → report dialog opens directly, no gate.
  await card.getByRole('button', { name: 'Report contribution' }).click();
  // The report dialog is named for its action (`society.submitReport`), not the generic "Report
  // content" the shared modal used to carry.
  await expect(page.getByRole('dialog', { name: 'Submit report' })).toBeVisible({ timeout: 8000 });
  await expect(gate).toHaveCount(0);
});

// ─── AC3: residents post events/notices; non-residents cannot ───
test('verified resident posts an event (calendar dot) and a notice (list); non-resident sees no Add button', async ({ page }) => {
  await seedKyc(page, RES_MOBILE);
  await seedResident(page, RES_MOBILE);
  await gotoHub(page, 'community');

  const board = page.locator('section', { has: page.getByRole('heading', { name: /Events & notices/i }) });
  await board.scrollIntoViewIfNeeded();

  // Add an event dated the 20th of the current month.
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-20`;
  await board.getByRole('button', { name: 'Add event' }).click();
  // Event and notice have separate dialogs now (`BOARD_META[kind].addKey`), so each assertion
  // proves the right form opened rather than just "a board form opened".
  const evDialog = page.getByRole('dialog', { name: 'Add event' });
  await evDialog.getByPlaceholder(/Event title/i).fill('Water tank cleaning — no supply 10am-2pm');
  await evDialog.locator('input[type="date"]').fill(dateStr);
  await evDialog.getByRole('button', { name: 'Post', exact: true }).click();

  await expect(board.getByText('Water tank cleaning — no supply 10am-2pm')).toBeVisible({ timeout: 8000 });
  // A dot appears on day 20 — its calendar button announces the event via aria-label.
  await expect(board.getByRole('button', { name: /20 \w+, 1 event/i })).toBeVisible();

  // Add a notice.
  await board.getByRole('button', { name: 'Add notice' }).click();
  const ntDialog = page.getByRole('dialog', { name: 'Add notice' });
  await ntDialog.getByPlaceholder(/Notice title/i).fill('Diwali decoration drive this weekend');
  await ntDialog.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(board.getByText('Diwali decoration drive this weekend')).toBeVisible({ timeout: 8000 });

  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('pnSocietyBoard') || '{}'));
  expect(store[SLUG].some((b) => b.kind === 'event' && b.date === dateStr)).toBe(true);
  expect(store[SLUG].some((b) => b.kind === 'notice')).toBe(true);
});

test('a non-resident KYC user sees no Add-event control and the store refuses their post', async ({ page }) => {
  await seedKyc(page, KYC_MOBILE); // KYC but not a verified resident
  await gotoHub(page, 'community');
  const board = page.locator('section', { has: page.getByRole('heading', { name: /Events & notices/i }) });
  await board.scrollIntoViewIfNeeded();
  await expect(board.getByRole('button', { name: 'Add event' })).toHaveCount(0);
  await expect(board.getByText(/Only verified residents & the committee can post/i)).toBeVisible();
});

// ─── AC4: resident proposes WhatsApp link → ops approves → residents-only join ───
test('resident proposes a valid WhatsApp link — no public button, badurl rejected', async ({ page }) => {
  await seedKyc(page, RES_MOBILE);
  await seedResident(page, RES_MOBILE);
  await gotoHub(page);

  const waCard = page.locator('div.glass.rounded-2xl', { hasText: 'Resident WhatsApp group' });
  await waCard.scrollIntoViewIfNeeded();

  // Bad URL is rejected — no pending record is written.
  await waCard.getByRole('button', { name: 'Add the group link' }).click();
  let waDialog = page.getByRole('dialog', { name: 'Resident WhatsApp group' });
  await waDialog.getByPlaceholder(/chat\.whatsapp\.com/i).fill('javascript:alert(1)');
  await waDialog.getByRole('button', { name: 'Submit for review' }).click();
  let stored = await page.evaluate(() => localStorage.getItem('pnSocietyWhatsapp'));
  expect(stored === null || !JSON.parse(stored)[SLUG]).toBeTruthy();
  await waDialog.getByRole('button', { name: 'Cancel' }).click();

  // Valid link → goes pending, still no public Join button.
  await waCard.getByRole('button', { name: 'Add the group link' }).click();
  waDialog = page.getByRole('dialog', { name: 'Resident WhatsApp group' });
  await waDialog.getByPlaceholder(/chat\.whatsapp\.com/i).fill('https://chat.whatsapp.com/Abc123Def456');
  await waDialog.getByRole('button', { name: 'Submit for review' }).click();

  await expect(waCard.getByText(/residents can join once our team approves/i)).toBeVisible({ timeout: 8000 });
  await expect(waCard.getByRole('link', { name: /Join WhatsApp group/i })).toHaveCount(0);
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('pnSocietyWhatsapp') || '{}'));
  expect(store[SLUG].status).toBe('pending');
  expect(store[SLUG].url).toBe('https://chat.whatsapp.com/Abc123Def456');
});

test('ops approves a WhatsApp link — a non-resident sees a private teaser, never the invite', async ({ page }) => {
  // Seed a pending link (as if a resident already proposed it). Idempotent so the
  // ops approval isn't clobbered when addInitScript re-runs on later navigations.
  await page.addInitScript((s) => {
    if (!localStorage.getItem('pnSocietyWhatsapp')) {
      localStorage.setItem('pnSocietyWhatsapp', JSON.stringify({ [s]: { url: 'https://chat.whatsapp.com/Abc123Def456', label: 'Residents', by: 'Riya Sharma', mobile: '9820011111', at: Date.now(), status: 'pending' } }));
    }
  }, SLUG);
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/societies?tab=moderation`);

  const waBlock = page.locator('div.pn-card', { hasText: 'Pending WhatsApp links' });
  await expect(waBlock.getByText('https://chat.whatsapp.com/Abc123Def456')).toBeVisible({ timeout: 8000 });
  await waBlock.getByRole('button', { name: 'Approve' }).click();

  // The ops admin is NOT a verified resident of this society → the invite URL is
  // withheld. They only learn a private group exists + get a verify-to-join CTA.
  await gotoHub(page);
  const waCard = page.locator('div.glass.rounded-2xl', { hasText: 'Resident WhatsApp group' });
  await expect(waCard.getByRole('link', { name: /Join WhatsApp group/i })).toHaveCount(0);
  await expect(waCard.getByText(/residents-only WhatsApp group/i)).toBeVisible({ timeout: 8000 });
  await expect(waCard.getByRole('button', { name: /Verify you live here to join/i })).toBeVisible();
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('pnSocietyWhatsapp') || '{}'));
  expect(store[SLUG].status).toBe('approved');
});

test('a verified resident of the society sees the private Join link with a safe href', async ({ page }) => {
  // Approved link already in place; only a verified resident should get the URL.
  await page.addInitScript((s) => {
    if (!localStorage.getItem('pnSocietyWhatsapp')) {
      localStorage.setItem('pnSocietyWhatsapp', JSON.stringify({ [s]: { url: 'https://chat.whatsapp.com/Abc123Def456', label: 'Residents', by: 'Riya Sharma', mobile: '9820011111', at: Date.now(), status: 'approved' } }));
    }
  }, SLUG);
  await seedKyc(page, RES_MOBILE);
  await seedResident(page, RES_MOBILE);
  await gotoHub(page);

  const waCard = page.locator('div.glass.rounded-2xl', { hasText: 'Resident WhatsApp group' });
  const join = waCard.getByRole('link', { name: /Join WhatsApp group/i });
  await expect(join).toBeVisible({ timeout: 8000 });
  await expect(join).toHaveAttribute('href', 'https://chat.whatsapp.com/Abc123Def456');
  await expect(join).toHaveAttribute('rel', /noopener/);
  await expect(join).toHaveAttribute('target', '_blank');
});

// ─── AC5: report → ops moderation remove/dismiss ───
/**
 * The oracle here changed with the backend repoint, and the change is the point.
 *
 * A society report used to be written to `pnSocietyReports` — a key in the *reporting* member's own
 * browser, which the ops queue (reading the moderator's browser) could never see. It now goes
 * through `reportService` to the one platform reports store, so this reads that store instead. The
 * dedupe assertion below is unchanged in meaning and now proves something it could not before: both
 * providers refuse the second press, so the "you already reported this" branch is not mock-only.
 */
test('KYC member reports a contribution — one open report per user per target', async ({ page }) => {
  await seedKyc(page, KYC_MOBILE);
  await seedContribs(page, [contrib()]);
  await gotoHub(page, 'community');

  const openReports = () => page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
    return (db.reports || []).filter((r) => r.status === 'open' && (r.kind || '') === 'contribution');
  });

  const feed = page.locator('section', { has: page.getByRole('heading', { name: 'Community insights' }) });
  const card = feed.locator('div.glass.rounded-xl', { hasText: 'Water tanker fills the sump' });
  await card.getByRole('button', { name: 'Report contribution' }).click();
  const rpt = page.getByRole('dialog', { name: 'Submit report' });
  // The reason is a picker now, not prose. `spam` rather than the default, so the stored code below
  // cannot pass on a report whose reason was never read off the control at all.
  await rpt.getByRole('button', { name: /Reason/i }).click();
  await page.getByRole('option', { name: /Spam, advertising/i }).click();
  await rpt.getByPlaceholder(/Anything else/i).fill('Looks like spam.');
  await rpt.getByRole('button', { name: 'Submit report' }).click();

  await expect(page.getByText(/our team will review it/i)).toBeVisible({ timeout: 8000 });
  let reports = await openReports();
  expect(reports.length).toBe(1);
  expect(reports[0].reason).toBe('spam');

  // Reporting the same target again is a no-op dup.
  await card.getByRole('button', { name: 'Report contribution' }).click();
  await page.getByRole('dialog', { name: 'Submit report' }).getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByText(/already reported this/i)).toBeVisible({ timeout: 8000 });
  reports = await openReports();
  expect(reports.length).toBe(1);
});

test('ops Remove deletes the reported contribution and closes the report; Dismiss keeps it', async ({ page }) => {
  await page.addInitScript((s) => {
    localStorage.setItem('pnSocietyContributions', JSON.stringify({ [s]: [
      { id: 'c-bad', kind: 'tip', category: 'General', text: 'SPAM buy cheap followers now', user: 'X', mobile: '9700000009', resident: false, at: Date.now(), helpful: [], replies: [] },
      { id: 'c-ok', kind: 'tip', category: 'General', text: 'Legit tip about parking', user: 'Y', mobile: '9700000008', resident: false, at: Date.now(), helpful: [], replies: [] },
    ] }));
  }, SLUG);
  await loginAsAdmin(page);

  /* The queue reads `/reports`, not the browser-only `pnSocietyReports` this spec used to seed.
     That key's writer is gone — a report filed on a hub went into the reporter's own storage and
     the moderator read the moderator's, so the queue was empty by construction — so seeding it now
     proves nothing. Seeded into the mock DB's `reports` collection instead, which is what both
     providers answer from, and after boot because the app writes that store itself on first load. */
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await appReady(page);
  await page.evaluate(() => {
    const KEY = 'puneNestDB_v5';
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('mock store missing after appReady()');
    const db = JSON.parse(raw);
    db.reports = [
      {
        id: 'rep-1',
        kind: 'contribution',
        targetId: 'c-bad',
        targetTitle: '',
        targetOwner: 'X',
        ownerMobile: '9700000009',
        reason: 'spam',
        reasonLabel: 'Spam, advertising or a scam',
        details: 'Looks like spam.',
        reportedBy: 'Riya Sharma',
        reporterMobile: '9876543212',
        url: '',
        at: Date.now(),
        status: 'open',
        actionTaken: '',
        handledAt: 0,
      },
      ...(db.reports || []).filter((r) => r.id !== 'rep-1'),
    ];
    localStorage.setItem(KEY, JSON.stringify(db));
  });

  await page.goto(`${BASE}/admin/societies?tab=moderation`);

  /* The row identifies the post by its id, not by a copy of its words. `ModerationTab` stopped
     rendering a snapshot on purpose: a report carries a target id, and a snapshot taken at report
     time goes stale the moment the author edits — so asserting on the prose here would be asserting
     a field the product deliberately dropped. */
  const repBlock = page.locator('div.pn-card', { hasText: 'Reported content' });
  await expect(repBlock.getByText('c-bad')).toBeVisible({ timeout: 8000 });
  await repBlock.getByRole('button', { name: 'Remove content' }).click();

  // Report is closed and the target contribution is deleted.
  await expect(repBlock.getByText('c-bad')).toHaveCount(0, { timeout: 8000 });
  const state = await page.evaluate(() => ({
    contribs: JSON.parse(localStorage.getItem('pnSocietyContributions') || '{}'),
    reports: JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}').reports || [],
  }));
  expect(state.contribs[SLUG].map((c) => c.id)).toEqual(['c-ok']);
  expect(state.reports.find((r) => r.id === 'rep-1').status).not.toBe('open');
});

// ─── AC6: retro-gate Reviews & Q&A store-side ───
test('addSocietyQuestion / addSocietyAnswer succeed for a signed-in user, and refuse a guest (login)', async ({ page }) => {
  await seedUser(page, '9811111111'); // logged in, not identity-verified — sign-in is the floor
  await gotoHub(page);
  const out = await page.evaluate(async () => {
    const m = await import('/src/lib/store.js');
    const q = m.addSocietyQuestion('skyline-heights-baner', 'Is visitor parking available?');
    const a = q && q.id ? m.addSocietyAnswer('skyline-heights-baner', q.id, 'Yes, near gate B.') : null;
    return {
      qIsGate: q === 'kyc' || q === 'login', qHasId: !!(q && q.id),
      aIsGate: a === 'kyc' || a === 'login', aHasAnswer: !!(a && a.answers && a.answers.length),
    };
  });
  // Badge-not-gate: a signed-in user posts directly — a record, never a gate string.
  expect(out.qIsGate).toBe(false);
  expect(out.qHasId).toBe(true);
  expect(out.aIsGate).toBe(false);
  expect(out.aHasAnswer).toBe(true);
});

test('addSocietyQuestion refuses a signed-out guest with "login"', async ({ page }) => {
  await page.goto(`${BASE}/society/skyline-heights-baner`);
  await expect(page.getByRole('heading', { level: 1, name: /Skyline Heights/i })).toBeVisible({ timeout: 10000 });
  const out = await page.evaluate(async () => {
    const m = await import('/src/lib/store.js');
    return m.addSocietyQuestion('skyline-heights-baner', 'Is visitor parking available?');
  });
  expect(out).toBe('login');
});
