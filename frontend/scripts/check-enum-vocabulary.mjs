/**
 * Contract vocabularies pinned against the client catalogues that talk to them: every member of
 * every bridged vocabulary is pushed through the real read and write paths, in both directions.
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

/* A line scanner rather than a parser: the frontend has no yaml dependency and this would be the
   only reason to add one. Both shapes are handled — inline flow and block form. The colon is part
   of the match because "enum" appears in schema prose, and the match is case-sensitive because
   otherwise `hideNumber` and `pageNumber` fire. */
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
const { LAND_USE } = await import('../src/data/propertyTypes.js');
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
console.log('');
