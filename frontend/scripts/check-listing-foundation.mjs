/**
 * The re-moderation rule, pinned across the three places it is written down (D76).
 *
 *   node scripts/check-listing-foundation.mjs
 *
 * No backend process, no browser: this reads the Java source as text and the client modules as
 * modules.
 *
 * ## Why this file exists
 *
 * "Editing this field sends your listing back for review" is a promise the owner acts on. It was
 * written down three times, in three vocabularies, and none of the three agreed:
 *
 *   1. `ListingService.apply` (Java, wire names) — the only one that decides anything.
 *   2. `LISTING_FOUNDATION_FIELDS` in `src/lib/store/listings.js` (store/seed names) — a mirror.
 *   3. `FOUNDATION_FORM_KEYS` in `src/pages/consumer/list-property/editPolicy.js` (wizard form
 *      names) — what the owner is actually shown.
 *
 * The drift ran both ways: the client warned on `floor`/`facing`/`age`/`area` (which the server
 * does not revert on, and several of which are not even in the update contract) and stayed silent
 * on `price` and `furnishing` (which take an approved listing out of search). So the banner told an
 * owner a price cut "goes live now" while the server pulled the listing offline. Correcting one of
 * the three lists is what produced that state in the first place — the fix has to be the check.
 *
 * ## What is asserted
 *
 *   1. **The server's two sets**, read out of `ListingService.apply` by finding the `if (in.x() ...)`
 *      blocks that set `remoderationRequired` (off search) and those that set `recheckOnly` (stays
 *      live). They must also be disjoint: a field in both, or in neither, is the bug.
 *   2. **The same two sets, from an independent oracle** — `ListingFoundationTest`'s `OFF_SEARCH`
 *      and `STAYS_LIVE`, whose union is derived from the search facets rather than from `apply`.
 *      Two readings of the rule that were written for different reasons, so agreement is evidence
 *      rather than a tautology.
 *   3. **The owner path acts on both outcomes and the moderator path on neither.** The rule the
 *      client mirrors is `update`'s, not `updateAsModerator`'s; if that ever inverted, mirroring
 *      `apply` alone would quietly mean the wrong thing.
 *   4. **Both client lists translate onto the server's sets**, exactly, in both directions — and
 *      per set, so a field silently moving from one to the other is caught.
 *   5. **The wizard actually reports it** — `classifyChanges` is run over a real edit for every
 *      foundation field, and must put the off-search half in `remoderation` and the stays-live half
 *      in `staysLive` but *not* `remoderation`. This is the assertion with teeth: the lists agreeing
 *      while the banner reads a different array is precisely the shape the original defect took
 *      after its first fix, and telling an owner their listing goes dark when it does not is the
 *      same lie pointed the other way (Q14).
 *
 * Exit code 0 = they agree, 1 = drift (suitable for CI).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

const SERVICE = join(repo, 'backend/src/main/java/com/punenest/api/catalog/listing/ListingService.java');
const TEST = join(repo, 'backend/src/test/java/com/punenest/api/catalog/listing/ListingFoundationTest.java');
const STORE = join(here, '..', 'src/lib/store/listings.js');

/* The store predates the wire contract and names three fields differently: `type` is the wire's
   `propertyType`, and the seed carries the possession facet as `construction`. This table is the
   only place the two vocabularies meet, and it lives in the checker rather than in either module
   so neither one gets to define the other. */
const STORE_TO_WIRE = {
  deal: 'deal',
  locality: 'locality',
  bhk: 'bhk',
  type: 'propertyType',
  price: 'price',
  furnishing: 'furnishing',
  construction: 'possession',
  address: 'address',
};

const failures = [];
let checks = 0;

const read = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    failures.push(`cannot read ${p}\n      This check has no oracle without it. If the file moved, move this path with it.`);
    return '';
  }
};

const sorted = (set) => [...set].sort().join(', ');

function sameSet(actual, expected, what) {
  checks += 1;
  const missing = [...expected].filter((x) => !actual.has(x));
  const extra = [...actual].filter((x) => !expected.has(x));
  if (missing.length || extra.length) {
    failures.push(
      `${what}\n      expected: ${sorted(expected)}\n      actual:   ${sorted(actual)}`
      + (missing.length ? `\n      missing:  ${missing.sort().join(', ')}` : '')
      + (extra.length ? `\n      extra:    ${extra.sort().join(', ')}` : ''),
    );
  }
}

function ok(condition, what) {
  checks += 1;
  if (!condition) failures.push(what);
}

const quoted = (blob) => [...blob.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);

/* ─── 1. The server's set, read off ListingService.apply ──────────────────────────────────────
   Each foundation block is `if (in.x() != null && ...) { p.setX(...); <flag> = true; }`. None of
   those blocks nests braces, which is what makes a flat scan honest here — and if one ever does,
   the emptiness assertions below fail rather than silently dropping a field. */
console.log('\n  1. ListingService.apply — the two foundation sets');
const serviceSrc = read(SERVICE);
const applyBody = (serviceSrc.split('private EditImpact apply(Property p, ListingUpdate in) {')[1] || '')
  .split('return new EditImpact(')[0];

ok(applyBody.length > 0, 'ListingService.apply not found — its signature changed, so this check is reading nothing');

const applyBlocks = [...applyBody.matchAll(/if \(in\.(\w+)\(\)[^{]*\{([^{}]*)\}/g)];
const blocksSetting = (flag) =>
  new Set(applyBlocks.filter(([, , body]) => new RegExp(`${flag}\\s*=\\s*true`).test(body)).map(([, field]) => field));

const serverOffSearch = blocksSetting('remoderationRequired');
const serverStaysLive = blocksSetting('recheckOnly');
const serverSet = new Set([...serverOffSearch, ...serverStaysLive]);

ok(serverOffSearch.size > 0, 'no off-search fields parsed out of ListingService.apply — the block shape changed and this check now proves nothing');
ok(serverStaysLive.size > 0, 'no stays-live fields parsed out of ListingService.apply — the block shape changed and this check now proves nothing');

/* A field in both sets would make the outcome depend on block order; a field in neither is a search
   facet that costs nothing, which is the bait-and-switch this whole rule exists to price. */
const inBoth = [...serverOffSearch].filter((f) => serverStaysLive.has(f));
ok(
  inBoth.length === 0,
  `ListingService.apply puts ${inBoth.join(', ')} in BOTH foundation sets. The outcome would then`
  + ' depend on which flag `update` tests first, which is not a rule anyone can explain to an owner.',
);
console.log(`     off search: ${sorted(serverOffSearch)}`);
console.log(`     stays live: ${sorted(serverStaysLive)}`);

/* ─── 2. An independent oracle ────────────────────────────────────────────────────────────────
   ListingFoundationTest checks the union against PropertyController.search's facets — the
   buyer-facing filters the rule exists to protect — rather than against `apply`. Each half is
   compared separately here, because a field quietly moving between the two sets is the drift that
   actually costs something: it either takes a listing dark that should have stayed up, or leaves a
   wrong answer in the index. */
console.log('  2. ListingFoundationTest OFF_SEARCH / STAYS_LIVE agree');
const testSrc = read(TEST);
const oracle = (name) => {
  const blob = (new RegExp(`Set<String> ${name}\\s*=\\s*(?:\\r?\\n\\s*)?Set\\.of\\(([\\s\\S]*?)\\);`).exec(testSrc) || [])[1] || '';
  const set = new Set(quoted(blob));
  ok(set.size > 0, `ListingFoundationTest#${name} not found — half the independent oracle is gone`);
  return set;
};
sameSet(serverOffSearch, oracle('OFF_SEARCH'), 'ListingService.apply off-search set vs ListingFoundationTest#OFF_SEARCH');
sameSet(serverStaysLive, oracle('STAYS_LIVE'), 'ListingService.apply stays-live set vs ListingFoundationTest#STAYS_LIVE');

/* ─── 3. It is the OWNER path that reverts ────────────────────────────────────────────────────
   `apply` only reports; `update` acts on it and `updateAsModerator` deliberately does not (a
   moderator's own correction must not enter their own queue, under either outcome). The client
   mirrors the owner rule, so pin which one that is — and that both outcomes are still wired up. */
console.log('  3. update() reverts or queues a re-check; updateAsModerator() does neither');
ok(
  /if \(impact\.remoderationRequired\(\)\) \{\s*p\.revertToPending\(\);/.test(serviceSrc),
  'ListingService.update no longer reverts to pending on an off-search foundation change — the client'
  + ' banner now describes a rule the server does not have. Decide which is right before editing this check.',
);
ok(
  /else if \(impact\.recheckOnly\(\)\) \{\s*p\.requestRecheck\(/.test(serviceSrc),
  'ListingService.update no longer queues a re-check for the stays-live foundation fields, so a price'
  + ' edit is now free. That is a moderation hole, not a simplification (Q14).',
);
const moderatorBody = (serviceSrc.split('public Property updateAsModerator(')[1] || '').split('\n    }')[0];
ok(
  moderatorBody.includes('apply(p, in);') && !moderatorBody.includes('revertToPending')
    && !moderatorBody.includes('requestRecheck'),
  'updateAsModerator now reverts to pending or queues a re-check — a staff typo fix would take the'
  + ' listing off the site, or file staff a ticket to check their own correction. If that is intended'
  + ' it is a product change, not a checker change.',
);

/* ─── 4. Both client lists translate onto it ──────────────────────────────────────────────────── */
console.log('  4. lib/store/listings.js LISTING_FOUNDATION_FIELDS');
const storeSrc = read(STORE);
const storeBlob = (/export const LISTING_FOUNDATION_FIELDS = \[([^\]]*)\]/.exec(storeSrc) || [])[1] || '';
const storeFields = quoted(storeBlob);
ok(storeFields.length > 0, 'LISTING_FOUNDATION_FIELDS not found in src/lib/store/listings.js');
const untranslated = storeFields.filter((f) => !(f in STORE_TO_WIRE));
ok(
  untranslated.length === 0,
  `LISTING_FOUNDATION_FIELDS names a field this checker cannot translate to a wire name: ${untranslated.join(', ')}.`
  + ' Add it to STORE_TO_WIRE here, or drop it from the list.',
);
sameSet(new Set(storeFields.map((f) => STORE_TO_WIRE[f]).filter(Boolean)), serverSet, 'store mirror vs ListingService.apply');

console.log('  5. list-property/editPolicy.js FOUNDATION_*_KEYS');
const {
  FOUNDATION_FORM_KEYS, FOUNDATION_OFF_SEARCH_KEYS, FOUNDATION_STAYS_LIVE_KEYS,
  TIER_A_FIELDS, TIER_B_FIELDS, classifyChanges,
} = await import('../src/pages/consumer/list-property/editPolicy.js');
sameSet(new Set(Object.keys(FOUNDATION_OFF_SEARCH_KEYS)), serverOffSearch, 'editPolicy FOUNDATION_OFF_SEARCH_KEYS vs ListingService.apply');
sameSet(new Set(Object.keys(FOUNDATION_STAYS_LIVE_KEYS)), serverStaysLive, 'editPolicy FOUNDATION_STAYS_LIVE_KEYS vs ListingService.apply');
sameSet(new Set(Object.keys(FOUNDATION_FORM_KEYS)), serverSet, 'editPolicy FOUNDATION_FORM_KEYS vs ListingService.apply');

/* Every mapped form key must be a field the wizard reports on at all: `classifyChanges` only ever
   emits keys drawn from the two tier lists, so a form key that is in neither is a mapping entry
   that can never fire — silently, which is the failure mode this whole file exists for. */
const reportable = new Set([...TIER_A_FIELDS, ...TIER_B_FIELDS].map((f) => f.key));
for (const [wire, formKeys] of Object.entries(FOUNDATION_FORM_KEYS)) {
  for (const key of formKeys) {
    ok(
      reportable.has(key),
      `FOUNDATION_FORM_KEYS maps ${wire} → '${key}', but '${key}' is in neither TIER_A_FIELDS nor`
      + ' TIER_B_FIELDS, so classifyChanges can never report it and the owner is never warned.',
    );
  }
}

/* ─── 6. The wizard reports it, over a real edit ──────────────────────────────────────────────
   The lists agreeing is not the promise; the banner is. Change one field at a time and require it
   to land in the bucket that matches what the server will actually do — and, just as importantly,
   *not* in the other one. "Your listing comes off search" is a lie in both directions: it is a
   broken promise when the listing quietly went dark, and a deterrent that stops owners keeping
   their price honest when it did not (Q14). Neither half may ever be counted as `instant`. */
console.log('  6. classifyChanges routes each foundation edit to the outcome the server will pick');
const PROBE = { price: ['1000000', '1200000'], monthlyRent: ['25000', '31000'], bhk: ['2', '3'], propertyType: ['flat', 'villa'], locality: ['Kothrud', 'Baner'], deal: ['sale', 'rent'], furnishing: ['unfurnished', 'semi'], possession: ['ready', 'under-construction'] };
const probe = (key) => {
  const [before, after] = PROBE[key] || ['before', 'after'];
  return classifyChanges({ [key]: before }, { [key]: after });
};

for (const formKeys of Object.values(FOUNDATION_OFF_SEARCH_KEYS)) {
  for (const key of formKeys) {
    const cls = probe(key);
    ok(cls.remoderation.some((c) => c.key === key), `editing '${key}' is not reported as re-moderation, but the server reverts the listing for it`);
    ok(cls.recheck.some((c) => c.key === key), `editing '${key}' is missing from \`recheck\`, so the banner never lists it`);
    ok(!cls.staysLive.some((c) => c.key === key), `editing '${key}' is reported as staying live, but the server takes the listing off search for it`);
    ok(!cls.instant.some((c) => c.key === key), `editing '${key}' is counted as "publishes instantly" while the server takes the listing off search`);
  }
}

for (const formKeys of Object.values(FOUNDATION_STAYS_LIVE_KEYS)) {
  for (const key of formKeys) {
    const cls = probe(key);
    ok(cls.staysLive.some((c) => c.key === key), `editing '${key}' is not reported as a stays-live re-check, but the server queues one for it`);
    ok(cls.recheck.some((c) => c.key === key), `editing '${key}' is missing from \`recheck\`, so the banner never lists it`);
    ok(
      !cls.remoderation.some((c) => c.key === key),
      `editing '${key}' is reported as re-moderation, so the owner is told their listing comes off`
      + ' search — but the server keeps it approved and searchable. That warning is what stops owners'
      + ' correcting these fields at all, which is the cost Q14 removed.',
    );
    ok(!cls.instant.some((c) => c.key === key), `editing '${key}' is counted as "publishes instantly" while the server queues a re-check for it`);
  }
}

/* And the converse — an ordinary edit must not claim re-moderation, or the warning becomes noise
   and owners learn to ignore it. `description` is Tier B, `floor` is Tier A; neither reverts. */
const ordinary = classifyChanges({ description: 'a', floor: '3' }, { description: 'b', floor: '7' });
ok(ordinary.remoderation.length === 0, 'a description/floor edit is reported as re-moderation, but the server does not revert on either');
ok(ordinary.staysLive.length === 0, 'a description/floor edit is reported as a server-side re-check, but the server classifies neither field');
ok(ordinary.instant.some((c) => c.key === 'description'), 'a description edit is no longer reported as publishing instantly');
ok(ordinary.recheck.some((c) => c.key === 'floor'), 'a floor edit is no longer reported as a re-check');

/* ─── Report ──────────────────────────────────────────────────────────────────────────────────── */
if (failures.length) {
  console.error(`\n  ✗ ${failures.length} of ${checks} checks failed\n`);
  failures.forEach((f) => console.error(`    • ${f}\n`));
  console.error('  The owner-facing edit warning and the server disagree about what a re-review costs.');
  console.error('  Reconcile them (D76, Q14) — do not relax this check to make it pass.\n');
  process.exit(1);
}
console.log(`\n  ✓ ${checks} checks passed — the server, its test, the store mirror and the wizard agree\n`);
