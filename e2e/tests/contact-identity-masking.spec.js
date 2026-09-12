import { test, expect } from '@playwright/test';

/* Regression: masked owner numbers must never be used as a storage identity.
 *
 * The API masks an owner's mobile to '98XXXXX210' (first two + last three digits).
 * lib/contact.js used to derive its localStorage bucket from digits(ownerMobile),
 * and digits('98XXXXX210') === '98210' — a short but plausible-looking key. Two
 * different owners sharing a first-two/last-three prefix therefore collapsed onto
 * ONE bucket, so a contact request addressed to owner A could surface in owner B's
 * dashboard. isFullMobile() now requires exactly 10 digits, and the key builders
 * return null (read nothing, write nothing) for anything less.
 *
 * These assertions exercise the module directly rather than driving the UI: the
 * defect lives in pure key-derivation logic, and the Vite dev server already serves
 * the ES module, so a page-context import is the most precise way to pin it. */

const MOD = '/src/lib/contact.js';

/** Load lib/contact.js inside the page and run `fn` against its exports. */
async function withContact(page, fn, arg) {
  await page.goto('/');
  return page.evaluate(
    async ([mod, body, a]) => {
      const m = await import(/* @vite-ignore */ mod);
      // eslint-disable-next-line no-new-func
      return new Function('m', 'arg', `return (${body})(m, arg);`)(m, a);
    },
    [MOD, fn.toString(), arg ?? null],
  );
}

test('a masked owner number is not accepted as an identity', async ({ page }) => {
  const res = await withContact(page, (m) => ({
    masked: m.isFullMobile('98XXXXX210'),
    maskedRendered: m.isFullMobile('+91 98••• •••10'),
    empty: m.isFullMobile(''),
    nullish: m.isFullMobile(null),
    short: m.isFullMobile('98210'),
    real: m.isFullMobile('9530047855'),
    // The exact collapse that caused the leak.
    collapsesTo: String('98XXXXX210').replace(/\D/g, ''),
  }));

  expect(res.masked).toBe(false);
  expect(res.maskedRendered).toBe(false);
  expect(res.empty).toBe(false);
  expect(res.nullish).toBe(false);
  expect(res.short).toBe(false);
  expect(res.real).toBe(true);
  // Documents *why* the mask is dangerous: it still yields digits.
  expect(res.collapsesTo).toBe('98210');
});

test('two owners with the same masked form do not share a contact bucket', async ({ page }) => {
  // The leak, reproduced end-to-end. In http mode the API hands the client a MASKED
  // owner number, and 9812345670 and 9899999670 both mask to the identical string
  // '98XXXXX670'. Before the fix that string keyed a bucket ('...:98670'), so a request
  // stored while viewing owner A's listing was read back on owner B's listing.
  const res = await withContact(page, (m) => {
    localStorage.setItem('draazyUser', JSON.stringify({ name: 'Buyer', mobile: '9876543210' }));
    // What the server actually sends: first two + last three digits.
    const mask = (n) => n.slice(0, 2) + 'XXXXX' + n.slice(7);
    const maskedA = mask('9812345670');
    const maskedB = mask('9899999670');

    m.saveContactReqs(maskedA, [{ id: 'for-owner-A', status: 'pending', buyerMobile: '9876543210', propId: 'P1' }]);

    return {
      // Two distinct owners, one indistinguishable masked string — this is the root cause.
      masksAreIdentical: maskedA === maskedB,
      // Owner B must not see a request that was addressed to owner A.
      leakedToB: m.getContactReqs(maskedB).map((r) => r.id),
      // And the masked write must not have been persisted anywhere at all.
      readBackFromA: m.getContactReqs(maskedA).map((r) => r.id),
      realOwnerA: m.getContactReqs('9812345670').map((r) => r.id),
    };
  });

  expect(res.masksAreIdentical).toBe(true);
  expect(res.leakedToB).toEqual([]);
  expect(res.readBackFromA).toEqual([]);
  expect(res.realOwnerA).toEqual([]);
});

test('real 10-digit owners keep separate contact buckets', async ({ page }) => {
  // The other half of the guarantee: the fix must not merge legitimate identities.
  const res = await withContact(page, (m) => {
    localStorage.setItem('draazyUser', JSON.stringify({ name: 'Buyer', mobile: '9876543210' }));
    m.saveContactReqs('9812345670', [{ id: 'a', status: 'pending', buyerMobile: '9876543210', propId: 'P1' }]);
    m.saveContactReqs('9899999670', [{ id: 'b', status: 'pending', buyerMobile: '9876543210', propId: 'P2' }]);
    return {
      ownerA: m.getContactReqs('9812345670').map((r) => r.id),
      ownerB: m.getContactReqs('9899999670').map((r) => r.id),
      countA: m.pendingContactCount('9812345670'),
    };
  });

  expect(res.ownerA).toEqual(['a']);
  expect(res.ownerB).toEqual(['b']);
  expect(res.countA).toBe(1);
});

test('a masked owner number neither reads nor writes contact state', async ({ page }) => {
  const res = await withContact(page, (m) => {
    localStorage.setItem('draazyUser', JSON.stringify({ name: 'Buyer', mobile: '9876543210' }));
    const before = Object.keys(localStorage).length;
    const request = m.requestContact('98XXXXX210', 'P5000');
    return {
      request,
      status: m.contactStatus('98XXXXX210', 'P5000'),
      isOwner: m.isOwnerViewer('98XXXXX210'),
      prefs: m.getOwnerPrefsFor('98XXXXX210'),
      keysAdded: Object.keys(localStorage).length - before,
    };
  });

  // Honest refusal, not a faked "pending" that never persisted.
  expect(res.request).toBe('unavailable');
  expect(res.status).toBe('none');
  expect(res.isOwner).toBe(false);
  expect(res.prefs).toEqual({});
  expect(res.keysAdded).toBe(0);
});

test('the owner of a listing is still recognised by their full number', async ({ page }) => {
  // Guards the fix from over-correcting: real 10-digit identities must keep working.
  const res = await withContact(page, (m) => {
    localStorage.setItem('draazyUser', JSON.stringify({ name: 'Owner', mobile: '9530047855' }));
    return {
      isOwner: m.isOwnerViewer('9530047855'),
      // Spacing/punctuation is irrelevant — only the digit count matters.
      isOwnerSpaced: m.isOwnerViewer('95300 47855'),
      // A country-coded value is 12 digits, so it is NOT an identity. This matches the
      // behaviour before the fix (digits() never stripped '91'), and nothing in the app
      // stores a +91-prefixed mobile — fmtPhone() adds it for display only. Failing here
      // merely under-reveals, which is the safe direction.
      isOwnerCountryCoded: m.isOwnerViewer('+91 95300 47855'),
      status: m.contactStatus('9530047855', 'P5000'),
      stranger: m.isOwnerViewer('9812345670'),
    };
  });

  expect(res.isOwner).toBe(true);
  expect(res.isOwnerSpaced).toBe(true);
  expect(res.isOwnerCountryCoded).toBe(false);
  expect(res.status).toBe('owner');
  expect(res.stranger).toBe(false);
});

test('a session without a mobile does not inherit a shared Verified badge', async ({ page }) => {
  // loginStaff() stores `mobile: ''`, so a mobile-less session is genuinely reachable.
  // isViewerVerified() used to key on digits(mobile) || 'anon', which meant every such
  // session shared ONE badge bucket — one of them verifying made all of them verified,
  // bypassing an owner's "accept verified contacts only" preference.
  const res = await withContact(page, (m) => {
    // Someone else's badge, sitting in the legacy shared bucket.
    localStorage.setItem('draazyAadhaar:anon', JSON.stringify({ verified: true }));
    // An owner who only accepts verified contacts.
    localStorage.setItem('dzOwnerPrefs:9530047855', JSON.stringify({ verifiedContactOnly: true }));
    // A signed-in session carrying no mobile of its own.
    localStorage.setItem('draazyUser', JSON.stringify({ name: 'No Mobile', mobile: '' }));

    return { request: m.requestContact('9530047855', 'P5000') };
  });

  // Must be challenged for verification, NOT waved through on a borrowed badge.
  expect(res.request).toBe('verification_required');
});

test('a real Verified badge still satisfies a verified-only owner', async ({ page }) => {
  // The other side of the guarantee: failing closed must not lock out a genuinely
  // verified buyer.
  const res = await withContact(page, (m) => {
    localStorage.setItem('dzOwnerPrefs:9530047855', JSON.stringify({ verifiedContactOnly: true }));
    localStorage.setItem('draazyUser', JSON.stringify({ name: 'Buyer', mobile: '9876543210' }));
    localStorage.setItem('draazyAadhaar:9876543210', JSON.stringify({ verified: true }));
    return { request: m.requestContact('9530047855', 'P5000') };
  });

  expect(res.request).toBe('pending');
});

test('owner privacy prefs round-trip on a full number and are isolated per owner', async ({ page }) => {
  const res = await withContact(page, (m) => {
    localStorage.setItem('draazyUser', JSON.stringify({ name: 'Owner', mobile: '9530047855' }));
    m.setOwnerPrefs({ hideNumber: true });
    return {
      mine: m.getOwnerPrefs(),
      hides: m.ownerHidesNumber('9530047855'),
      otherOwner: m.ownerHidesNumber('9812345670'),
      viaMask: m.ownerHidesNumber('95XXXXX855'),
    };
  });

  expect(res.mine.hideNumber).toBe(true);
  expect(res.hides).toBe(true);
  expect(res.otherOwner).toBe(false);
  expect(res.viaMask).toBe(false);
});

/* RETIRED (D256): "the contact gate hides the owner number for a buyer regardless of the owner
 * pref (D5)" reached into `services/providers/mock/contactProvider.js` by dynamic import, and that
 * module went with the mock tree. It is not being ported, because porting it would have pinned a
 * claim the shipping build does not make: the mock gate returned `ownerHidesNumber: true`
 * unconditionally, whereas `ContactStatusResponse` derives it from `users.hide_number` per owner.
 * The two disagreed, and the mock's version was the one under test. What the server actually does
 * is the thing worth guarding; `ContactGateEndpointsTest` currently only asserts the field
 * `.exists()`, so the *value* is unpinned on both sides. Recorded as a gap rather than papered
 * over — see COVERAGE.md.
 *
 * Every other test in this file survives untouched: they exercise `lib/contact.js` directly, which
 * has 38 importers and no mock dependency at all. */
