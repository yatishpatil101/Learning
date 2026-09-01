-- V106: society hub content becomes reportable, and reportable content becomes removable.
--
-- The society hub carries six kinds of user-written content -- recommendations,
-- replies, questions, answers, noticeboard items and reviews -- and offers a
-- "Report" control on every one of them. That control wrote to `pnSocietyReports`
-- in the reporting member's own browser, and the ops queue that was supposed to
-- read it read the *moderator's* browser. So a defamatory recommendation naming a
-- real tradesman with his real phone number could be reported by fifty neighbours
-- and no moderator would ever see one of those reports. The platform-wide
-- `reports` table has worked properly since V18 -- it simply did not admit that
-- society content existed: `reports_target_type_check` allowed exactly
-- 'property', 'user', 'review' and 'post'.
--
-- Two changes, and they have to arrive together.
--
-- 1. The CHECK constraint learns the five society kinds. Five, not one
--    'society_content', because `target_id` means nothing without knowing which
--    table it indexes -- a moderator who upholds a complaint has to be able to
--    remove *that row*, and five tables means five lookups otherwise, with the
--    id ambiguity that implies. `review` is deliberately NOT duplicated here:
--    a society review is already reportable as 'review' and already has its own
--    takedown at PATCH /reviews/{id}/status. A second vocabulary word for the
--    same thing would split the queue in half.
--
-- 2. The five content tables learn how to be taken down. Before this there was
--    no way: the author's own DELETE hard-deletes the row, which is right for an
--    author changing their mind and wrong for moderation -- it destroys the
--    evidence the complaint was about, so an appeal, a repeat-offender check and
--    a police request all have nothing to read. `removed_at` / `removed_by` keep
--    the row and take it off the public site.
--
-- The pair moves together, enforced by a CHECK on each table, for the same reason
-- V105 pairs a society's verification with the operator who granted it: a removal
-- with nobody's name on it cannot answer the only question it will ever be asked.

alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
    check (target_type in ('property', 'user', 'review', 'post',
                           'society_contribution', 'society_reply',
                           'society_question', 'society_answer', 'society_board'));

alter table public.society_contributions add column removed_at timestamptz;
alter table public.society_contributions add column removed_by uuid references public.users(id);
alter table public.society_contributions add constraint ck_society_contribution_removal_pair
    check ((removed_at is null) = (removed_by is null));

alter table public.society_contribution_replies add column removed_at timestamptz;
alter table public.society_contribution_replies add column removed_by uuid references public.users(id);
alter table public.society_contribution_replies add constraint ck_society_reply_removal_pair
    check ((removed_at is null) = (removed_by is null));

alter table public.society_questions add column removed_at timestamptz;
alter table public.society_questions add column removed_by uuid references public.users(id);
alter table public.society_questions add constraint ck_society_question_removal_pair
    check ((removed_at is null) = (removed_by is null));

alter table public.society_answers add column removed_at timestamptz;
alter table public.society_answers add column removed_by uuid references public.users(id);
alter table public.society_answers add constraint ck_society_answer_removal_pair
    check ((removed_at is null) = (removed_by is null));

alter table public.society_board_items add column removed_at timestamptz;
alter table public.society_board_items add column removed_by uuid references public.users(id);
alter table public.society_board_items add constraint ck_society_board_removal_pair
    check ((removed_at is null) = (removed_by is null));

comment on column public.society_contributions.removed_at is
    'Taken off the public site by a moderator. The row survives: the complaint was about its '
    'contents, so destroying them destroys the appeal, the repeat-offender check and any later '
    'lawful request. Null for everything the public can read.';
comment on column public.society_contributions.removed_by is
    'The moderator who removed it. Paired with removed_at by ck_society_contribution_removal_pair.';

-- No index. Removals are a handful of rows against a table read one society at a
-- time, and the predicate rides along on the society_id lookup that is already
-- indexed; a second index here would cost every post to earn nothing.

select install_updated_at_triggers();
