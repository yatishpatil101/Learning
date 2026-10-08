-- Retired rows release their Place IDs, so the building can be added again as a live society.
update societies set place_id = null
where archived_at is not null and place_id is not null;

-- A live row merged into a retired survivor would vanish from the catalogue; bring it back.
update societies c set merged_into = null, merged_at = null, merged_by = null, updated_at = now()
from societies s
where c.merged_into = s.id and s.archived_at is not null and c.archived_at is null;

-- Backs the follower-alert fan-out: one alert per follower per listing, even if two runs race.
delete from notifications a
using notifications b
where a.type = 'match.society-listing' and b.type = a.type
  and b.user_id = a.user_id and b.link = a.link
  and (b.created_at, b.id) < (a.created_at, a.id);

create unique index if not exists uq_notifications_society_listing
    on notifications (user_id, link) where type = 'match.society-listing';
