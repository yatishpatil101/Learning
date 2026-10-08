-- Retired society community features: rollout-safe step only. The drops live in db/pending/V95.

delete from reports
where target_type in ('society_contribution', 'society_reply', 'society_question',
                      'society_answer', 'society_board');

alter table reports drop constraint if exists reports_target_type_check;
alter table reports add constraint reports_target_type_check
    check (target_type in ('property', 'user', 'review', 'post'));

-- Emptied now so no claimant or resident PII outlives the feature while the drops wait for V95.
-- `if exists`: dev and e2e databases that ran an earlier draft of V94 already dropped them.
do $$
declare t text;
begin
    foreach t in array array['society_contribution_helpful', 'society_contribution_replies',
                             'society_contributions', 'society_answers', 'society_questions',
                             'society_board_items', 'society_proposals', 'society_residents',
                             'society_claims'] loop
        if to_regclass('public.' || t) is not null then
            execute format('delete from %I', t);
        end if;
    end loop;
end $$;

drop index if exists idx_society_candidates;
create index idx_society_candidates
    on societies (created_at desc)
    where source = 'community' and merged_into is null and archived_at is null;
