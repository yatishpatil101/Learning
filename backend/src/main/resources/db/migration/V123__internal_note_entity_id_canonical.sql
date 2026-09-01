-- D30. Merge the two case files a listing's notes were split across.
--
-- `internal_notes.entity_id` is text and was stored exactly as the caller sent it (V90 explains why
-- it is not a foreign key). A listing answers to two public identifiers -- its slug and its uuid --
-- and the contract accepts either on every `/properties/{id}` route, so both were arriving. The
-- moderation console sends the slug; the enquiries board sends the uuid. One listing, two note
-- histories, and no error anywhere: each writer read back precisely what it had written, so both
-- screens looked right and neither could see the other's rows. A note about responding to an
-- enquiry was filed where the review modal's timeline never looks -- which reads exactly like
-- nobody wrote one, the failure V90 was created to end.
--
-- `NoteEntityKey` now resolves a slug to its uuid before any read or write, so new notes cannot
-- split. This backfills the rows written before it existed, so the history a slug-keyed note
-- belongs to is the one it shows up in.
--
-- The join is the whole predicate: a row moves only when its entity_id IS some property's slug. A
-- uuid never equals a slug, so uuid-keyed rows are untouched, and so is any id that resolves to
-- nothing -- a note whose target has since been deleted outright keeps its raw key rather than
-- being dropped, which is the same bargain V90 struck for archived listings.
--
-- `updated_at` is deliberately left alone. There is no trigger on this table, and merging two
-- buckets is not someone editing the note: `note.edit` carries a previous wording and this has
-- none. Bumping it would put a false "edited just now" on rows nobody touched.
UPDATE internal_notes n
   SET entity_id = p.id::text
  FROM properties p
 WHERE n.entity_type = 'property'
   AND n.entity_id = p.slug;
