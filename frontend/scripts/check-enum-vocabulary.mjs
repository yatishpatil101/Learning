/**
 * Contract vocabularies, pinned against the client catalogues that talk to them.
 *
 *   node scripts/check-enum-vocabulary.mjs
 *
 * No backend process, no browser: this reads the OpenAPI contract as text and the client modules
 * as modules.
 *
 * ## Why this file exists
 *
 * The contract calls a half-furnished home `semi-furnished`. Every catalogue in `src/` calls it
 * `semi`. `propertyMapper` handed the value straight across without translating it, and one
 * untranslated word produced three separate failures:
 *
 *   - an owner could not post a semi-furnished home at all — 422, with nothing they could change
 *     to fix it, on the wizard's own default for a rental and the commonest answer in this market;
 *   - `furnishings=semi` matched no row, so the filter read as an empty catalogue rather than as a
 *     broken control;
 *   - a semi-furnished listing came back and rendered as an em-dash, because the label lookup only
 *     knows the UI keys.
 *
 * The whole mock e2e suite stayed green through all three. It had to: the mock provider stores and
 * returns `semi`, so both sides of the browser agreed with each other and disagreed only with
 * Postgres. Nothing that runs without a server can see a contract mismatch — unless it reads the
 * contract, which is what this does.
 *
 * The shape is what makes it survivable. `unfurnished` and `furnished` are spelled the same on both
 * sides; exactly one member of three differs. Two of the three chips worked, so the axis looked
 * wired. **A vocabulary that mostly agrees is more dangerous than one that plainly does not**, and
 * a sampled check would have passed. So this file enumerates every member of every bridged
 * vocabulary, in both directions.
 *
 * ## What is asserted
 *
 *   1. **The contract still declares the enums this file names.** A renamed or deleted schema is a
 *      failure here, not a silent skip — a checker that stops finding its subject stops checking.
 *   2. **Every UI value survives the write path.** Each catalogue member is pushed through the real
 *      exported writer (`toListingCreate`, `toFacetQuery`) and the result must be a member of the
 *      contract enum. This is the assertion with teeth: it exercises the translation table *and its
 *      call site*, which is the pair that actually failed. A correct table wired into the wrong
 *      function is exactly how the first fix of this bug was incomplete — `toQuery` was translated
 *      and `toFacetQuery`, the one the listings page calls, was not.
 *   3. **Every contract value survives the read path.** Each enum member is pushed through
 *      `toViewModel` and must land on a catalogue key, so a value the server can return but the
 *      browser cannot name is caught before it renders as an em-dash.
 *   4. **Vocabularies that are supposed to be identical still are.** Where client and contract
 *      share a spelling there is no table to protect them, so the sets are compared directly. This
 *      is what catches a rename on either side.
 *   5. **The flatmate fork stays forked.** The contract genuinely carries two furnishing
 *      vocabularies — `Furnishing` says `semi-furnished`, the three flatmate schemas say `semi` —
 *      so `VOCAB.furnishing` is correct *because* it is untranslated. Pinning it stops a later
 *      reader "fixing" the inconsistency and breaking the flatmate write path to match a bug that
 *      no longer exists.
 *   6. **The known-unmappable register is not stale.** A client value the contract has no bucket
 *      for is registered with a reason rather than quietly dropped, and the register itself is
 *      checked: an entry that has stopped drifting is a failure, so the list cannot rot into
 *      permanent noise.
 *
 * Exit code 0 = they agree, 1 = drift (suitable for CI).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

/* The contract is hand-written and single-source. The stale copies under the backend build
   directories are output, not source, and are deliberately not read. */
const SPEC = join(repo, 'backend/src/main/resources/static/openapi/draazy-api.yaml');

const failures = [];
const notes = [];
let checks = 0;

const ok = (cond, msg) => {
  checks += 1;
  if (!cond) failures.push(msg);
};

const sameSet = (actual, expected, what) => {
  checks += 1;
  const missing = [...expected].filter((v) => !actual.has(v));
  const extra = [...actual].filter((v) => !expected.has(v));
  if (missing.length || extra.length) {
    failures.push(
      `${what}: ${missing.length ? `contract has ${missing.map((v) => `'${v}'`).join(', ')} and the client does not` : ''}`
      + `${missing.length && extra.length ? '; ' : ''}`
      + `${extra.length ? `client has ${extra.map((v) => `'${v}'`).join(', ')} and the contract does not` : ''}`,
    );
  }
};

/* ─── Reading the contract ────────────────────────────────────────────────────────────────────
   A line scanner rather than a parser, because the frontend has no yaml dependency and adding one
   for this would be the only such dependency in the tree. Two shapes exist in the file and both
   are handled: inline flow (`enum: [a, b, c]`, all but one declaration) and block form (`enum:`
   followed by `- value` lines).

   Two traps, both hit while writing this. The word "enum" appears in prose comments in the schema
   region ("that enum has five values"), so the colon is part of the match. And a case-insensitive
   match fires on `hideNumber` and `pageNumber` — hence case-sensitive throughout. */
const specText = readFileSync(SPEC, 'utf8');
const specLines = specText.split(/\r?\n/);

/** All enum declarations in the file, keyed by the schema that encloses them. */
function readEnums() {
  const bySchema = new Map();
  let schema = null;
  for (let i = 0; i < specLines.length; i += 1) {
    const line = specLines[i];
    // Schema names sit at exactly four spaces under `components: schemas:`.
    const named = /^ {4}([A-Za-z0-9_]+):\s*$/.exec(line);
    if (named) schema = named[1];
    if (!/\benum:/.test(line)) continue;

    const inline = /\benum:\s*\[([^\]]*)\]/.exec(line);
    let values;
    if (inline) {
      values = inline[1].split(',').map((v) => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else {
      values = [];
      for (let j = i + 1; j < specLines.length; j += 1) {
        const item = /^\s*-\s*(.+?)\s*$/.exec(specLines[j]);
        if (!item) break;
        values.push(item[1].replace(/^['"]|['"]$/g, ''));
      }
    }
    if (!values.length) continue;
    /* The field this enum constrains. Two layouts, both present in the file: flow style, where the
       enum sits on the field's own line (`furnishing: { type: string, enum: [...] }`), and block
       style, where the field name is a standalone key some lines above. */
    const STRUCTURAL = new Set(['items', 'properties', 'additionalProperties']);
    let inlineField = (/^\s{6,}([A-Za-z0-9_]+):\s*\{/.exec(line) || [])[1] || null;
    if (inlineField && STRUCTURAL.has(inlineField)) inlineField = null;
    let field = inlineField;
    for (let j = i; j >= 0 && !field; j -= 1) {
      const f = /^\s{6,}([A-Za-z0-9_]+):\s*$/.exec(specLines[j]);
      /* `items` and `properties` are structure, not field names. An array-valued facet declares its
         enum one level down (`tenants: { type: array, items: { enum: [...] } }`), so a scan that
         stops at the first key up finds the wrapper and reports the field as missing. */
      if (f && !STRUCTURAL.has(f[1])) field = f[1];
    }
    const key = schema || '(root)';
    if (!bySchema.has(key)) bySchema.set(key, []);
    bySchema.get(key).push({ field, values, line: i + 1 });
  }
  return bySchema;
}

const enums = readEnums();

/* Blindness guard. If the scanner stops understanding the file it must say so rather than pass
   with nothing to compare — the failure mode every check in this directory is written against. */
const declared = [...enums.values()].reduce((n, list) => n + list.length, 0);
ok(
  declared >= 150,
  `only ${declared} enum declarations were found in the contract, which is far below the ~210 that`
  + ' are there. The scanner has stopped understanding the file, so every comparison below is'
  + ' vacuous. Fix readEnums(), do not lower this floor.',
);

/** The values of a named top-level enum schema, e.g. `Furnishing`. */
function topLevelEnum(name) {
  const found = enums.get(name);
  if (!found || !found.length) {
    ok(false, `the contract no longer declares a '${name}' schema with an enum. If it was renamed, `
      + 'this checker needs the new name — deleting the bridge is how the drift comes back.');
    return null;
  }
  checks += 1;
  return new Set(found[0].values);
}

/** The values of an inline enum on one field of one schema, e.g. `PropertySummary.landUse`. */
function fieldEnum(schema, field) {
  const found = (enums.get(schema) || []).find((e) => e.field === field);
  if (!found) {
    ok(false, `the contract no longer declares an enum on ${schema}.${field}. If it moved, this `
      + 'checker needs the new location — deleting the bridge is how the drift comes back.');
    return null;
  }
  checks += 1;
  return new Set(found.values);
}

/* ─── The client side ─────────────────────────────────────────────────────────────────────────── */
const { FURN, CONSTR_STATUS, TENANTS, ROOM_TYPES } = await import('../src/pages/consumer/listings/constants.js');
const { LAND_USE, PG_SHARING } = await import('../src/data/propertyTypes.js');
const { VOCAB } = await import('../src/services/providers/http/flatmateMapper.js');
const { toViewModel, toListingCreate } = await import('../src/services/providers/http/propertyMapper.js');
const { toFacetQuery } = await import('../src/lib/listings/facetQuery.js');

const keysOf = (catalogue) => catalogue.map((e) => (Array.isArray(e) ? e[0] : e.value ?? e)).filter((k) => k !== '');

/* A filter state complete enough for `toFacetQuery` to consider the axis relevant. `sectionVisible`
   drops any facet the chosen property types do not make meaningful, so a bare `{}` would return
   `undefined` for everything and every assertion below would pass without testing anything. */
const filterState = (axis, value) => ({
  deal: axis === 'constr' ? 'buy' : 'rent',
  types: new Set(['flat']),
  [axis]: new Set([value]),
});

/* ─── Known-unmappable: client values the contract has no bucket for ─────────────────────────────
   Registered rather than silently dropped, and each entry is itself checked below — an entry that
   has stopped drifting fails, so this list cannot decay into permanent noise that everyone scrolls
   past. */
const KNOWN_UNMAPPABLE = [
  {
    catalogue: 'PG_SHARING',
    value: 'dorm',
    reason:
      'The Indian PG model runs single → dormitory, and the wizard offers "Dormitory (6+)". The'
      + ' contract\'s sharing facet stops at `five`, so selecting Dormitory narrows the search to'
      + ' nothing. Sharing is not on ListingCreate either, so no owner-posted PG can carry any'
      + ' occupancy yet — closing this needs a server bucket, not a client table.',
  },
];

/* ─── 1–3. Furnishing: mismatched, translated, exercised in both directions ────────────────────── */
console.log('  1. Furnishing');
const furnishingWire = topLevelEnum('Furnishing');
if (furnishingWire) {
  for (const ui of keysOf(FURN)) {
    const written = toListingCreate({ furnishing: ui }).furnishing;
    ok(
      furnishingWire.has(written),
      `posting a listing with furnishing '${ui}' puts '${written}' on the wire, which is not one of`
      + ` ${[...furnishingWire].join(', ')}. The server rejects it 422 and the owner cannot act on it.`,
    );

    const facet = toFacetQuery(filterState('furnishing', ui)).furnishings || [];
    ok(
      facet.length > 0 && facet.every((v) => furnishingWire.has(v)),
      `filtering by furnishing '${ui}' sends ${facet.length ? facet.map((v) => `'${v}'`).join(', ') : 'nothing'},`
      + ` which the contract does not accept. The filter matches no row and the page reads as an`
      + ' empty catalogue rather than as a broken control.',
    );
  }

  const uiFurnishing = new Set(keysOf(FURN));
  for (const wire of furnishingWire) {
    const read = toViewModel({ id: 'x', furnishing: wire }).furnishing;
    ok(
      uiFurnishing.has(read),
      `a listing the server returns as '${wire}' reads back as '${read}', which is not a catalogue`
      + ' key. The label lookup only knows the catalogue, so the detail page renders an em-dash.',
    );
  }
}

/* ─── Possession: the same shape, translated since V79, kept honest by the same round trip ─────── */
console.log('  2. PropertyPossession');
const possessionWire = topLevelEnum('PropertyPossession');
if (possessionWire) {
  for (const ui of keysOf(CONSTR_STATUS)) {
    const written = toListingCreate({ construction: ui }).possession;
    ok(
      possessionWire.has(written),
      `posting a listing with construction status '${ui}' puts '${written}' on the wire, which is`
      + ` not one of ${[...possessionWire].join(', ')}.`,
    );
    const facet = toFacetQuery(filterState('constr', ui)).construction || [];
    ok(
      facet.length > 0 && facet.every((v) => possessionWire.has(v)),
      `filtering by construction status '${ui}' sends ${facet.length ? facet.map((v) => `'${v}'`).join(', ') : 'nothing'},`
      + ' which the contract does not accept.',
    );
  }
  const uiConstruction = new Set(keysOf(CONSTR_STATUS));
  for (const wire of possessionWire) {
    const read = toViewModel({ id: 'x', possession: wire }).construction;
    ok(
      uiConstruction.has(read),
      `a listing the server returns with possession '${wire}' reads back as '${read}', which is not`
      + ' a catalogue key.',
    );
  }
}

/* ─── 4. Vocabularies that share a spelling, and so have nothing protecting them ───────────────── */
console.log('  4. identical vocabularies (no table, nothing to protect them)');
const identical = [
  ['LAND_USE', keysOf(LAND_USE), fieldEnum('PropertySummary', 'landUse')],
  ['ROOM_TYPES', keysOf(ROOM_TYPES), fieldEnum('PropertySummary', 'room')],
  ['TENANTS', keysOf(TENANTS), fieldEnum('PropertySummary', 'tenants')],
];
for (const [name, uiKeys, wire] of identical) {
  if (wire) sameSet(new Set(uiKeys), wire, `${name} vs the contract`);
}

/* Sharing is compared as a subset rather than a set, because the register below carries the one
   member the contract has no bucket for. Everything else must still line up exactly. */
const sharingWire = fieldEnum('PropertySummary', 'sharing');
if (sharingWire) {
  const registered = new Set(KNOWN_UNMAPPABLE.filter((k) => k.catalogue === 'PG_SHARING').map((k) => k.value));
  const shareKeys = keysOf(PG_SHARING);
  for (const key of shareKeys) {
    if (registered.has(key)) continue;
    ok(sharingWire.has(key), `PG_SHARING offers '${key}' but the contract's sharing facet does not accept it, so selecting it narrows the search to nothing`);
  }
  for (const wire of sharingWire) {
    ok(shareKeys.includes(wire), `the contract's sharing facet accepts '${wire}' but PG_SHARING cannot offer it, so that occupancy is unreachable from the filter`);
  }
}

/* ─── 5. The flatmate fork is deliberate — pin it so nobody "fixes" it ────────────────────────── */
console.log('  5. the flatmate furnishing fork');
const flatmateFurnishing = fieldEnum('FlatmateRoom', 'furnishing');
if (flatmateFurnishing) {
  sameSet(new Set(VOCAB.furnishing), flatmateFurnishing, 'VOCAB.furnishing vs FlatmateRoom.furnishing');
  ok(
    !flatmateFurnishing.has('semi-furnished') && flatmateFurnishing.has('semi'),
    'FlatmateRoom.furnishing has moved onto the `semi-furnished` spelling used by `Furnishing`.'
    + ' If the two vocabularies really have merged, flatmateMapper needs a translation table and'
    + ' this assertion should be deleted — but silently mirroring the new spelling in VOCAB while'
    + ' the flatmate tables still hold `semi` breaks every existing room.',
  );
}

/* ─── 6. The register is still true ───────────────────────────────────────────────────────────── */
console.log('  6. known-unmappable register');
for (const entry of KNOWN_UNMAPPABLE) {
  ok(
    entry.reason && entry.reason.length > 40,
    `KNOWN_UNMAPPABLE entry ${entry.catalogue}.${entry.value} has no reason recorded. A registered`
    + ' mismatch without a reason is indistinguishable from an unnoticed one.',
  );
  if (entry.catalogue === 'PG_SHARING' && sharingWire) {
    ok(
      !sharingWire.has(entry.value),
      `KNOWN_UNMAPPABLE still lists PG_SHARING.'${entry.value}', but the contract now accepts it.`
      + ' Delete the entry so the value is checked like every other one.',
    );
    notes.push(`PG_SHARING.'${entry.value}' is registered as unmappable — ${entry.reason}`);
  }
}

/* ─── Report ──────────────────────────────────────────────────────────────────────────────────── */
if (failures.length) {
  console.error(`\n  x ${failures.length} of ${checks} checks failed\n`);
  failures.forEach((f) => console.error(`    - ${f}\n`));
  console.error('  A word the browser sends is not a word the server accepts. Whatever the owner');
  console.error('  types into that control is being thrown away, or matched against nothing.');
  console.error('  Add the translation to the mapper — do not relax this check to make it pass.\n');
  process.exit(1);
}
console.log(`\n  check-enum-vocabulary: ok (${checks} checks)`);
notes.forEach((n) => console.log(`    note: ${n}`));
console.log('');
