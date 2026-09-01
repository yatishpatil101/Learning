// @ts-check
import { test, expect } from '@playwright/test';
import { appReady } from '../../../helpers/app.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/**
 * Duplicate-listing prevention. Drives the real dedup engine
 * (src/lib/data/propertyIdentity.js) in the browser against a seeded mock DB, so
 * we lock the actual decision logic — not a reimplementation.
 *
 * Same owner + same physical unit  -> blocked (self-duplication).
 * Different owner + same unit       -> flagged for Ops, still posts.
 * Different unit                    -> clean.
 */
test.describe('Property duplicate prevention', () => {
  test('fingerprint + dedup decisions are correct', async ({ page }) => {
    await page.goto(`${BASE}/`);
    // The seed is written a beat after `goto` resolves (D129). Without this the read below
    // fell back to `{}` and wrote it straight back — an empty catalogue, so every dedup
    // decision came back "clean" and the test failed on the wrong assertion.
    await appReady(page);

    const r = await page.evaluate(async () => {
      const KEY = 'puneNestDB_v5';
      const raw = localStorage.getItem(KEY);
      if (!raw) throw new Error('mock store missing after appReady()');
      const db = JSON.parse(raw);
      db.listings = db.listings || [];
      // An existing, active listing owned by 9990001111 at a unique address+meter.
      db.listings.unshift({
        id: 'DUPTEST1',
        ownerMobile: '99900 01111',
        society: 'ZZ Dedup Test Society',
        locality: 'Baner',
        flatNumber: 'A-101',
        tower: 'A',
        pincode: '411045',
        electricityConsumerNo: '170012345678',
        status: 'approved',
      });
      localStorage.setItem(KEY, JSON.stringify(db));

      const m = await import('/src/lib/data/propertyIdentity.js');

      // Same flat identified two independent ways -> the key sets must intersect.
      const byMeter = m.fingerprintKeys({ electricityConsumerNo: '1700-1234-5678' });
      const byAddr = m.fingerprintKeys({ society: 'ZZ Dedup Test Society', flatNumber: 'A-101', pincode: '411045', locality: 'Baner' });

      const base = { society: 'ZZ Dedup Test Society', flatNumber: 'A-101', tower: 'A', pincode: '411045', locality: 'Baner' };

      return {
        meterKey: byMeter[0] || '',
        addrKey: byAddr[0] || '',
        // Meter number normalises (dashes/spaces stripped) to one stable key.
        ecNormEqual: m.fingerprintKeys({ electricityConsumerNo: '1700-1234-5678' })[0] === m.fingerprintKeys({ electricityConsumerNo: '170012345678' })[0],
        // Stored dedup key must NOT embed the raw meter number (it's private).
        meterKeyLeaksRaw: (byMeter[0] || '').includes('170012345678'),
        emptyKeys: m.fingerprintKeys({ locality: 'Baner' }), // no society/unit -> no key
        noUnitKeys: m.fingerprintKeys({ society: 'ZZ Dedup Test Society', locality: 'Baner', pincode: '411045' }), // society but no unit -> no key
        // a) same owner, matched by electricity number only -> blocked
        selfByMeter: m.evaluateListingDedup({ mobile: '9990001111', fields: { electricityConsumerNo: '170012345678' } }),
        // b) same owner, matched by structured address -> blocked
        selfByAddr: m.evaluateListingDedup({ mobile: '9990001111', fields: base }),
        // c) different owner, same address -> not blocked, flagged for Ops
        otherOwner: m.evaluateListingDedup({ mobile: '9998887777', fields: base }),
        // d) editing the same listing excludes itself -> no self-block
        editingSelf: m.evaluateListingDedup({ mobile: '9990001111', fields: base, excludeId: 'DUPTEST1' }),
        // e) a genuinely different flat -> clean
        different: m.evaluateListingDedup({ mobile: '9990001111', fields: { society: 'Totally Other Society', flatNumber: 'Z-9', pincode: '411057', locality: 'Wakad' } }),
      };
    });

    expect(r.meterKey).toMatch(/^ec:/);
    expect(r.meterKeyLeaksRaw).toBe(false);
    expect(r.ecNormEqual).toBe(true);
    expect(r.addrKey).toContain('addr:');
    expect(r.emptyKeys).toEqual([]);
    expect(r.noUnitKeys).toEqual([]);

    expect(r.selfByMeter.blocked).toBe(true);
    expect(r.selfByMeter.existingId).toBe('DUPTEST1');

    expect(r.selfByAddr.blocked).toBe(true);

    expect(r.otherOwner.blocked).toBe(false);
    expect(r.otherOwner.flagForReview).toBe(true);
    expect(r.otherOwner.flaggedAgainstId).toBe('DUPTEST1');

    expect(r.editingSelf.blocked).toBe(false);
    expect(r.editingSelf.flagForReview).toBe(false);

    expect(r.different.blocked).toBe(false);
    expect(r.different.flagForReview).toBe(false);
  });

  test('image-hash hamming + photo-based flag-not-block', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await appReady(page); // see the note above — read-modify-write on the seeded store

    const r = await page.evaluate(async () => {
      const KEY = 'puneNestDB_v5';
      const raw = localStorage.getItem(KEY);
      if (!raw) throw new Error('mock store missing after appReady()');
      const db = JSON.parse(raw);
      db.listings = db.listings || [];
      // An existing listing by owner A carrying a photo hash, at a DIFFERENT typed
      // address than the new submission (so only the photos can link them).
      db.listings.unshift({
        id: 'IMGTEST1',
        ownerMobile: '99911 22333',
        society: 'Old Broker Society',
        locality: 'Kothrud',
        flatNumber: 'C-303',
        pincode: '411038',
        status: 'approved',
        photoHashes: ['ffff0000ffff0000'],
      });
      localStorage.setItem(KEY, JSON.stringify(db));

      const img = await import('/src/lib/data/imageHash.js');
      const eng = await import('/src/lib/data/propertyIdentity.js');

      return {
        identical: img.hammingHex('ffff0000ffff0000', 'ffff0000ffff0000'),
        near: img.hammingHex('ffff0000ffff0000', 'ffff0000ffff0001'), // 1 bit
        far: img.hammingHex('ffff0000ffff0000', '0000ffff0000ffff'), // opposite
        malformed: img.hammingHex('ffff', ''),
        setMatch: img.photoSetsMatch(['ffff0000ffff0001'], ['ffff0000ffff0000']),
        setNoMatch: img.photoSetsMatch(['0000ffff0000ffff'], ['ffff0000ffff0000']),
        // Different owner, different typed address, but a near-identical photo ->
        // NOT blocked, but flagged for Ops with reason 'image'.
        crossOwnerImage: eng.evaluateListingDedup({
          mobile: '9997776666',
          fields: { society: 'Brand New Society', flatNumber: 'Z-1', pincode: '411001', locality: 'Baner' },
          photoHashes: ['ffff0000ffff0001'],
        }),
        // Same photo but SAME owner -> image signal must not flag against yourself.
        sameOwnerImage: eng.evaluateListingDedup({
          mobile: '9991122333',
          fields: { society: 'Brand New Society', flatNumber: 'Z-2', pincode: '411001', locality: 'Baner' },
          photoHashes: ['ffff0000ffff0000'],
        }),
      };
    });

    expect(r.identical).toBe(0);
    expect(r.near).toBe(1);
    expect(r.far).toBe(64);
    expect(r.malformed).toBe(Infinity);
    expect(r.setMatch).toBe(true);
    expect(r.setNoMatch).toBe(false);

    expect(r.crossOwnerImage.blocked).toBe(false);
    expect(r.crossOwnerImage.flagForReview).toBe(true);
    expect(r.crossOwnerImage.flagBy).toBe('image');
    expect(r.crossOwnerImage.flaggedAgainstId).toBe('IMGTEST1');

    expect(r.sameOwnerImage.flagForReview).toBe(false);
  });
});
