-- V84: give every admin-editable content row somewhere to keep its translations (D2).
--
-- The help page already localises FAQs. `lib/contentLang.js` reads suffixed fields off the record --
-- `q_mr`, `a_mr`, `q_hi` -- because a FAQ is written by an editor at runtime and therefore cannot
-- live in a locale bundle with the rest of the UI copy. The server has no such fields, so moving
-- the page onto `GET /faqs` would have looked fine (nothing is translated today) and then silently
-- regressed the first time somebody wrote a Marathi answer.
--
-- Nested, not suffixed. The alternative -- question_mr, answer_mr, category_mr, and the same three
-- again in Hindi -- is six columns on this table and eighteen more across the other three, and a
-- fourth language is another twelve. It also spreads one fact (this row, in Marathi) across three
-- columns that nothing constrains to agree: a row can have a Marathi question and an English answer
-- and the schema cannot tell you that happened. A single jsonb object keyed by language holds the
-- translation as the thing it is, and adding Hindi is data rather than DDL.
--
-- The shape is language -> field name -> text:
--
--   {"mr": {"question": "...", "answer": "...", "category": "..."}}
--
-- Field names inside are the *wire* names, not the column names, because the client is what reads
-- them and the client speaks the contract. For the four content types those happen to coincide.
--
-- No CHECK on the inner shape. Postgres could enforce that the value is an object, but not that its
-- keys are known languages or that its leaves are strings, so a partial check would buy the
-- appearance of validation while leaving the parts that actually go wrong unguarded. The Java side
-- types it as Map<String, Map<String, String>> and Jackson refuses anything else on the way in,
-- which is the real gate; `not null default '{}'` is here so a reader never has to distinguish
-- "no translations" from "column absent".
--
-- All four tables together, deliberately. Announcements, banners and services are the same kind of
-- object -- copy an editor writes and a visitor reads -- and answering the question once for FAQs
-- and again later for the others is how a codebase ends up with two conventions for one problem.

alter table faqs
    add column translations jsonb not null default '{}'::jsonb;

alter table announcements
    add column translations jsonb not null default '{}'::jsonb;

alter table banners
    add column translations jsonb not null default '{}'::jsonb;

alter table cms_services
    add column translations jsonb not null default '{}'::jsonb;
