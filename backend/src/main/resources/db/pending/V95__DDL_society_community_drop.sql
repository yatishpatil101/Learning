-- Contract step: move to db/migration after the release carrying V94 is live everywhere.

drop table if exists society_contribution_helpful;
drop table if exists society_contribution_replies;
drop table if exists society_contributions;
drop table if exists society_answers;
drop table if exists society_questions;
drop table if exists society_board_items;
drop table if exists society_proposals;
drop table if exists society_residents;
drop table if exists society_claims;

alter table societies drop constraint if exists ck_society_verified_pair;
alter table societies drop column if exists claim_status;
alter table societies drop column if exists verified_by;
alter table societies drop column if exists verified_at;
alter table societies drop column if exists loc_source;

alter table properties drop column if exists society_verified;
alter table properties drop column if exists conveyance_done;
