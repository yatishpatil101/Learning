/* Pins the re-moderation rule across the three places it is written down, because "editing this field
   sends your listing back for review" is a promise the owner acts on. Exit 1 = drift. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

/* Two Java files because the rule and the reaction to it are split: ListingEditRules decides what an edit
   costs, ListingService acts on the answer. Matched as literal text, so either file moving is a change here. */
const RULES = join(repo, 'backend/src/main/java/com/draazy/api/catalog/listing/ListingEditRules.java');
const SERVICE = join(repo, 'backend/src/main/java/com/draazy/api/catalog/listing/ListingService.java');
const TEST = join(repo, 'backend/src/test/java/com/draazy/api/catalog/listing/ListingFoundationTest.java');

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

/* 1. The server's set, read off ListingEditRules.apply. The scan only sees blocks opening `if (in.field()`,
   which is every foundation block but two: `commercialTypeChanged(p, in)` reads its subtype out of
   formDetails, and the `clearLandUse` arm nests an inner `if`. Each sets a flag this scan credits to no
   field, and is harmless only because a flat sibling block names that same field anyway. A *new* foundation
   field written in either shape would be dropped here in silence — write it flat, or widen this pattern. */
console.log('\n  1. ListingEditRules.apply — the two foundation sets');
const serviceSrc = read(SERVICE);
const applyBody = (read(RULES).split('EditImpact apply(Property p, ListingUpdate in) {')[1] || '')
  .split('return new EditImpact(')[0];

ok(applyBody.length > 0, 'ListingEditRules.apply not found — its signature changed, so this check is reading nothing');

const applyBlocks = [...applyBody.matchAll(/if \(in\.(\w+)\(\)[^{]*\{([^{}]*)\}/g)];
const blocksSetting = (flag) =>
  new Set(applyBlocks.filter(([, , body]) => new RegExp(`${flag}\\s*=\\s*true`).test(body)).map(([, field]) => field));

const serverOffSearch = blocksSetting('remoderationRequired');
const serverStaysLive = blocksSetting('recheckOnly');
const serverSet = new Set([...serverOffSearch, ...serverStaysLive]);

ok(serverOffSearch.size > 0, 'no off-search fields parsed out of ListingEditRules.apply — the block shape changed and this check now proves nothing');
ok(serverStaysLive.size > 0, 'no stays-live fields parsed out of ListingEditRules.apply — the block shape changed and this check now proves nothing');

/* A field in both sets would make the outcome depend on block order; a field in neither is a search
   facet that costs nothing, which is the bait-and-switch this whole rule exists to price. */
const inBoth = [...serverOffSearch].filter((f) => serverStaysLive.has(f));
ok(
  inBoth.length === 0,
  `ListingEditRules.apply puts ${inBoth.join(', ')} in BOTH foundation sets. The outcome would then`
  + ' depend on which flag `update` tests first, which is not a rule anyone can explain to an owner.',
);
console.log(`     off search: ${sorted(serverOffSearch)}`);
console.log(`     stays live: ${sorted(serverStaysLive)}`);

/* 2. An independent oracle: ListingFoundationTest derives the union from the search facets rather than
   from `apply`. Each half is compared separately, because a field moving between them is the costly drift. */
console.log('  2. ListingFoundationTest OFF_SEARCH / STAYS_LIVE agree');
const testSrc = read(TEST);
const oracle = (name) => {
  const blob = (new RegExp(`Set<String> ${name}\\s*=\\s*(?:\\r?\\n\\s*)?Set\\.of\\(([\\s\\S]*?)\\);`).exec(testSrc) || [])[1] || '';
  const set = new Set(quoted(blob));
  ok(set.size > 0, `ListingFoundationTest#${name} not found — half the independent oracle is gone`);
  return set;
};
sameSet(serverOffSearch, oracle('OFF_SEARCH'), 'ListingEditRules.apply off-search set vs ListingFoundationTest#OFF_SEARCH');
sameSet(serverStaysLive, oracle('STAYS_LIVE'), 'ListingEditRules.apply stays-live set vs ListingFoundationTest#STAYS_LIVE');

/* 3. The client mirrors the OWNER rule, so pin which path that is: `update` acts on the impact and
   `updateAsModerator` deliberately does not, and mirroring `apply` alone would not catch an inversion. */
console.log('  3. update() reverts or queues a re-check; updateAsModerator() does neither');

/* Blanks out every innermost `{...}` until none is left, so what remains is the statements the branch runs
   unconditionally. Position stopped being a proxy for that in 23aa4651, which opened two of these branches
   with a status guard; `beforeFirstIf` then read as "the rule is gone" rather than "the rule moved". */
const atDepthZero = (s) => {
  let out = s;
  let prev;
  do { prev = out; out = out.replace(/\{[^{}]*\}/g, ''); } while (out !== prev);
  return out;
};

const updateBody = (serviceSrc.split('public Property update(UUID userId,')[1] || '').split('\n    }')[0];
const remoderationBranch = (updateBody.split('if (impact.remoderationRequired()')[1] || '').split('} else if')[0];
ok(
  remoderationBranch.includes('p.revertToPending();'),
  'ListingService.update no longer reverts to pending on an off-search foundation change — the client'
  + ' banner now describes a rule the server does not have. Decide which is right before editing this check.',
);
/* Asserted on the guard rather than on its absence, because narrowing it is legitimate — a draft or an
   archived listing has no search placement to lose. APPROVED is the one status that must stay inside it:
   drop that and a live listing keeps answering a filter it was never re-checked against, silently. */
ok(
  remoderationBranch.includes('PropertyStatus.APPROVED.equals(p.getStatus())'),
  'ListingService.update reverts on an off-search foundation change, but no longer for an APPROVED'
  + ' listing — which is the only status where "comes off search" means anything. Every other status'
  + ' is already off search, so this guard is the whole rule.',
);
/* Asserted by emptying the branch of its nested blocks: the owner note may be conditional and the re-pend
   below is, but the re-check itself may not be — a price edit that queues nothing is a free edit. */
const recheckBranch = (serviceSrc.split('else if (impact.recheckOnly()) {')[1] || '').split('\n        }')[0];
ok(
  atDepthZero(recheckBranch).includes('p.requestRecheck('),
  'ListingService.update no longer queues a re-check for the stays-live foundation fields'
  + ' unconditionally, so a price edit can now be free. That is a moderation hole, not a'
  + ' simplification (Q14). The owner note may be conditional; the re-check may not.',
);
const moderatorBody = (serviceSrc.split('public Property updateAsModerator(')[1] || '').split('\n    }')[0];
ok(
  moderatorBody.includes('apply(p, in);'),
  'updateAsModerator no longer asks ListingEditRules what the edit costs, so a staff edit to a foundation'
  + ' field now bypasses the rule entirely rather than being exempted from its consequences.',
);
ok(
  !moderatorBody.includes('requestRecheck'),
  'updateAsModerator now files a re-check ticket, so staff are queued to check their own correction.'
  + ' If that is intended it is a product change, not a checker change.',
);
/* It may re-pend, and since 23aa4651 it does — but only a listing that is *already* pending, to reset a
   lifecycle verification the edit invalidated. The harm this guards is the live case: an APPROVED listing
   must never come off the site because staff fixed a typo, so the revert has to stay behind the guard. */
ok(
  !atDepthZero(moderatorBody).includes('revertToPending')
    && (!moderatorBody.includes('revertToPending')
      || moderatorBody.includes('PropertyStatus.PENDING.equals(p.getStatus())')),
  'updateAsModerator reverts to pending without first establishing the listing was already pending, so a'
  + ' staff typo fix would take a live listing off the site. If that is intended it is a product change,'
  + ' not a checker change.',
);

/* ─── 4. The live form maps onto it ────────────────────────────────────────────────────────────── */
console.log('  4. list-property/editPolicy.js FOUNDATION_*_KEYS');
const {
  FOUNDATION_FORM_KEYS, FOUNDATION_OFF_SEARCH_KEYS, FOUNDATION_STAYS_LIVE_KEYS,
  TIER_A_FIELDS, TIER_B_FIELDS, PHOTO_FIELD, classifyChanges,
} = await import('../src/pages/consumer/list-property/editPolicy.js');
sameSet(new Set(Object.keys(FOUNDATION_OFF_SEARCH_KEYS)), serverOffSearch, 'editPolicy FOUNDATION_OFF_SEARCH_KEYS vs ListingEditRules.apply');
sameSet(new Set(Object.keys(FOUNDATION_STAYS_LIVE_KEYS)), serverStaysLive, 'editPolicy FOUNDATION_STAYS_LIVE_KEYS vs ListingEditRules.apply');
sameSet(new Set(Object.keys(FOUNDATION_FORM_KEYS)), serverSet, 'editPolicy FOUNDATION_FORM_KEYS vs ListingEditRules.apply');

/* `classifyChanges` only ever emits keys from the two tier lists and PHOTO_FIELD, so a form key in none of
   them can never fire — silently. PHOTO_FIELD comes from the url arguments, hence neither tier list. */
const reportable = new Set([...TIER_A_FIELDS, ...TIER_B_FIELDS].map((f) => f.key).concat(PHOTO_FIELD.key));
for (const [wire, formKeys] of Object.entries(FOUNDATION_FORM_KEYS)) {
  for (const key of formKeys) {
    ok(
      reportable.has(key),
      `FOUNDATION_FORM_KEYS maps ${wire} → '${key}', but '${key}' is in neither TIER_A_FIELDS nor`
      + ' TIER_B_FIELDS, so classifyChanges can never report it and the owner is never warned.',
    );
  }
}

/* 5. The lists agreeing is not the promise; the banner is. "Your listing comes off search" is a lie in both
   directions, so each edit must land in the right bucket and *not* in the other, nor in `instant`. */
console.log('  5. classifyChanges routes each foundation edit to the outcome the server will pick');
const PROBE = { price: ['1000000', '1200000'], monthlyRent: ['25000', '31000'], bhk: ['2', '3'], propertyType: ['flat', 'villa'], locality: ['Kothrud', 'Baner'], deal: ['sale', 'rent'], furnishing: ['unfurnished', 'semi'], possession: ['ready', 'under-construction'] };
const probe = (key) => {
  // The gallery is not a form field; it reaches classifyChanges as the two url lists.
  if (key === PHOTO_FIELD.key) return classifyChanges({}, {}, ['a.jpg', 'b.jpg'], ['a.jpg']);
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

/* The converse: an ordinary edit must not claim re-moderation, or the warning becomes noise and owners
   learn to ignore it. `deposit` is Tier B and `floor` Tier A; the server classifies neither. */
const ordinary = classifyChanges({ deposit: '50000', floor: '3' }, { deposit: '60000', floor: '7' });
ok(ordinary.remoderation.length === 0, 'a deposit/floor edit is reported as re-moderation, but the server does not revert on either');
ok(ordinary.staysLive.length === 0, 'a deposit/floor edit is reported as a server-side re-check, but the server classifies neither field');
ok(ordinary.instant.some((c) => c.key === 'deposit'), 'a deposit edit is no longer reported as publishing instantly');
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
