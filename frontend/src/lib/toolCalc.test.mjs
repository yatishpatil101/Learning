import assert from 'node:assert/strict';
import { computeStampDuty, leaveLicenceStamp, monthsBetween, rentalYield } from './toolCalc.js';

assert.deepEqual(computeStampDuty(7500000, 7), { stamp: 525000, reg: 30000, total: 555000, rate: 7 });
assert.equal(computeStampDuty(1000000, 7).reg, 10000);
assert.equal(computeStampDuty(-5, 7).total, 0);

// ₹25,000 x 11 months + ₹1,00,000 deposit for 1 year: 0.25% of 2,85,000 = 712.5, rounded up to ₹800
assert.equal(leaveLicenceStamp(275000, 0, 100000, 1), 800);
assert.equal(leaveLicenceStamp(0, 0, 0, 1), 100);

assert.deepEqual(monthsBetween('2026-03', '2026-05'), ['2026-03', '2026-04', '2026-05']);
assert.deepEqual(monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
assert.equal(monthsBetween('2026-04', '2027-03').length, 12);
assert.deepEqual(monthsBetween('2026-04', '2027-04'), []);
assert.deepEqual(monthsBetween('2026-05', '2026-04'), []);
assert.deepEqual(monthsBetween('', '2026-04'), []);

const y = rentalYield({ price: 6000000, rent: 25000, maintenance: 2000, propertyTax: 12000, vacancyMonths: 1 });
assert.equal(y.grossRent, 300000);
assert.equal(y.netIncome, 25000 * 11 - 24000 - 12000);
assert.equal(y.gross, 5);
assert.ok(Math.abs(y.net - (239000 / 6000000) * 100) < 1e-9);
assert.equal(rentalYield({ price: 0, rent: 1, maintenance: 0, propertyTax: 0, vacancyMonths: 0 }).net, null);
assert.equal(rentalYield({ price: 100, rent: 1, maintenance: 5, propertyTax: 0, vacancyMonths: 0 }).payback, null);

console.log('toolCalc: ok');
