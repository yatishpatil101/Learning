-- V81: make the ops queue resurface a case when anything is said in it (D218).
--
-- property_reviews.updated_at is maintained by @UpdateTimestamp and by set_updated_at, and both
-- only fire when a row in *this* table is updated. review_messages.review_id is the owning side of
-- the association, so posting a message inserts a child row and leaves the parent untouched: the
-- queue, which sorts by updated_at desc, does not move the case. An owner replying to a moderator,
-- and a duplicate flag landing on a case file that already existed, both sank to wherever the case
-- happened to sit -- which for an old case is the bottom.
--
-- last_message_at is the fix and is also the honest column to sort a conversation queue on. Writing
-- it dirties the parent, so updated_at starts tracking message activity as a side effect; but the
-- desk should read this one, because updated_at also moves for a checklist tick.
--
-- Backfilled from the messages that already exist, so existing cases sort correctly on the first
-- deploy rather than all appearing silent. Cases with no messages keep NULL, which sorts last under
-- NULLS LAST -- correct, since a case nobody has spoken in is not waiting on a reply.
alter table property_reviews
    add column last_message_at timestamptz;

update property_reviews r
set last_message_at = m.latest
from (select review_id, max(created_at) as latest from review_messages group by review_id) m
where m.review_id = r.id;

-- Partial: the queue only ever orders by this among cases that have one, and a partial index keeps
-- the never-spoken-in cases out of it entirely.
create index if not exists idx_property_reviews_last_message
    on property_reviews (last_message_at desc)
    where last_message_at is not null;
