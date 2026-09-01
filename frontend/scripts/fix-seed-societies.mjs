/* One-off patcher: bind seeded listings to societies (D19).
   Applies exactly the rule `bindSocieties` in generate-seed.mjs applies, to the already-written
   src/data/db.json, so the checked-in seed does not have to be regenerated. A full regeneration
   would rewrite every `createdAt` (they are relative to the day the generator runs) and every
   hand-added listing that was appended after the last run, which is a churned diff nobody can
   review for a change that touches one field.

   Kept, not deleted, for the same reason fix-seed-realism.mjs is: it is the executable record of
   what was done to the committed seed, and it is idempotent — it clears `societySlug` before it
   rebinds, so re-running it after a regeneration converges rather than compounding. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOCIETIES } from '../src/data/societies.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');

function bindSocieties(listings) {
  const byLocality = new Map();
  for (const s of SOCIETIES) {
    if (!byLocality.has(s.localitySlug)) byLocality.set(s.localitySlug, []);
    byLocality.get(s.localitySlug).push(s);
  }
  const cursor = new Map();
  let bound = 0;
  listings.forEach((l, i) => {
    delete l.societySlug;
    if (i % 4 === 0) return;
    const pool = byLocality.get(l.localitySlug);
    if (!pool || !pool.length) return;
    const n = cursor.get(l.localitySlug) || 0;
    cursor.set(l.localitySlug, n + 1);
    l.societySlug = pool[n % pool.length].slug;
    bound++;
  });
  return bound;
}

const dbPath = join(DATA, 'db.json');
const db = JSON.parse(readFileSync(dbPath, 'utf8'));
const bound = bindSocieties(db.listings);
writeFileSync(dbPath, JSON.stringify(db, null, 2));
// db.json only. src/data/properties.json is a generator by-product that nothing imports and that
// has drifted from db.listings since; rewriting it here would churn 2400 lines for no reader.

console.log(`bound ${bound} of ${db.listings.length} listings`);
for (const l of db.listings) console.log(' ', l.id, l.localitySlug, '->', l.societySlug || '(unbound)');
