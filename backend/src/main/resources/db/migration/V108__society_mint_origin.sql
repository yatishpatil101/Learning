-- V108 — what human action minted a society: `mint_origin`.
--
-- WHY THIS EXISTS
--
-- The searcher-facing Society Finder is a tool for one question: "I want a flat in this building
-- and there isn't one listed — tell me when there is." When the building is not in the catalogue,
-- the finder mints it. The listing wizard mints too, from the other end: "I am posting a flat here
-- and you don't have my society."
--
-- Those are the same row and two completely different facts about the market. A society minted from
-- the finder is demand nobody is serving; a society minted from the wizard is supply arriving. The
-- ops candidates queue used to show that distinction as a chip -- "Searcher demand" against "From a
-- listing" -- and an operator reading the queue used it to decide which buildings to go and source
-- inventory in. That was the whole point of having a finder at all.
--
-- When minting moved to `POST /societies` (V105) the distinction was dropped: the request carries a
-- name, a locality and a pin, and nothing about who asked. The queue went binary-blind, and the
-- product question the finder exists to answer -- which societies are searchers asking for that
-- nobody has listed in? -- stopped being answerable from the database at all.
--
-- WHY THIS IS NOT `source`, AND WHY THE NAME IS DELIBERATELY UNLIKE IT
--
-- `societies.source` already exists and holds `curated` / `rera` / `community`. It is tempting to
-- add a fourth value there and be done. That would be wrong, and quietly so: the two columns
-- answer different questions and a row needs both answered.
--
--   source      -- where this row came from AS A DATA RECORD. We typed it in; a MahaRERA filing
--                  gave it to us; a member added it. It is the honesty field a reader weighs when
--                  deciding how much to believe the record.
--   mint_origin -- WHAT HUMAN ACTION produced it. A searcher asking for a building, or a lister
--                  posting a flat in one. It is an ops and demand-signal field. It says nothing
--                  about how trustworthy the record is.
--
-- Every `mint_origin` row is `source = 'community'` and always will be, which is exactly why they
-- must stay separate: folding a second axis into `source` would make `community` mean "member-added"
-- on Tuesday and "member-added, from a listing" on Wednesday, and every existing CHECK, index and
-- comparison against `'community'` would have to learn about a distinction none of them care about.
-- The candidates queue's partial index (V105) filters on `source = 'community'` and must keep
-- working unchanged whichever end the mint came from.
--
-- The column is named `mint_origin` rather than anything containing "source" so that nobody reading
-- a query six months from now has to work out which of two similarly-named columns they are looking
-- at. If a third mint surface ever appears it gets a third value here, not a fourth `source`.
--
-- WHY THE BACKFILL IS NULL AND NOT A VALUE
--
-- Nullable, with no default, and every existing row left null. Three groups of rows, and null is
-- the honest answer for all three:
--
--   * curated and rera rows were never minted by a person at all. There is no human action to
--     record. `'listing'` would claim a lister typed in 348 MahaRERA imports.
--   * community rows minted before V108 came through `POST /societies` from both surfaces,
--     indistinguishably. We did not record which, so we do not know which. Backfilling them to
--     `'listing'` because it is the commoner case invents a fact; backfilling them to `'demand'`
--     would be worse, because `'demand'` is the value ops act on -- it would send an operator to go
--     source inventory in a building nobody ever asked about.
--
-- So null means "not recorded", which is true, rather than a guess that reads as data. The reader
-- consuming this must treat null as unknown and not as the absence of demand. Note for whoever
-- repoints the ops UI: a two-branch chip of the form `origin === 'demand' ? "Searcher demand" :
-- "From a listing"` turns every null into a confident lie about a pre-V108 row. It needs three
-- branches, or the null row needs no chip at all.
--
-- New rows do get a value: `SocietyMintService` defaults an omitted origin to `'listing'`, which is
-- safe in the one direction that matters. Every shipped mint surface except the finder is on the
-- listing side, and the finder sends `'demand'` explicitly -- so a default can under-report demand
-- but can never fabricate it, and under-reported demand is a queue that is quieter than reality
-- rather than one that sends an operator somewhere pointless.

alter table public.societies add column mint_origin text;

-- Enumerated in the database rather than only in the application, for the same reason
-- `societies_source_check` is: this column steers an operator's day, and a typo'd `'demmand'`
-- written by a future caller would not error anywhere -- it would simply never match, and the
-- building would sit in the queue looking like supply forever.
alter table public.societies
    add constraint ck_society_mint_origin
    check (mint_origin is null or mint_origin in ('demand', 'listing'));

comment on column public.societies.mint_origin is
    'What human action minted this society: ''demand'' (a searcher looked for the building and it '
    'was not in the catalogue) or ''listing'' (somebody posting a flat could not find their '
    'society). NOT the same axis as `source`, and deliberately named so they cannot be confused: '
    '`source` says where the row came from as a data record (curated / rera / community) and is '
    'what a reader weighs for trustworthiness; `mint_origin` says which human action produced it '
    'and is what ops reads to find unserved demand. Every row with a mint_origin has '
    'source = ''community''. Null means not recorded -- true of all curated and RERA rows, which '
    'nobody minted, and of every community row created before V108, whose surface was not captured. '
    'Treat null as unknown, never as "not demand".';

select install_updated_at_triggers();
