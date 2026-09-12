package com.draazy.api.moderation.report;

import java.util.Set;

/**
 * What a moderator actually <em>did</em> to the thing that was reported.
 *
 * <p><strong>Why this exists at all.</strong> Before it, {@code PATCH /reports/{id}} could move a
 * complaint to {@code actioned} and nothing else happened: the listing stayed live, the account
 * stayed signed in, and the only trace of the "action" was the word {@code actioned} in a status
 * column and whatever the moderator typed into the note. The admin queue's buttons said "Take down"
 * and "Suspend" and neither took anything down or suspended anybody — the queue accepted the
 * obligation and had no way to discharge it. This vocabulary is the discharge.
 *
 * <p><strong>Why it is a field on triage rather than a separate endpoint.</strong> A moderator who
 * has to make two calls can make one and not the other, and the two orders fail differently: hide
 * first and the queue still shows the complaint as open; close first and the content is still up
 * with the report marked handled. Carrying the enforcement in the triage body makes the decision and
 * its effect one transaction, so there is no interleaving in which the platform's records disagree
 * with the platform's behaviour.
 *
 * <p><strong>Not every reportable kind can be enforced against yet, and that is stated rather than
 * hidden.</strong> {@link ReportTargetTypes#PROPERTY} and {@link ReportTargetTypes#USER} have
 * moderation primitives that already exist, are already audited, and already refuse self-dealing —
 * {@code PropertyModerationService.flag} and {@code UserAdminService.archive}. {@code review} and
 * {@code post} do not, from here:
 *
 * <ul>
 *   <li>{@code review} <em>can</em> be taken down, but only through {@code PATCH
 *       /reviews/{id}/status}, which is its own guarded transition with its own audit row. Reaching
 *       it from here would create a second write path into {@code reviews.status} — and the two
 *       would then have to be kept agreeing forever about what "taken down" means to the rating
 *       aggregate. Until that is one method rather than two, the moderator makes the second call
 *       deliberately.</li>
 *   <li>{@code post} (share-flat / flatmate) has a moderation column and no service-level verb that
 *       a report can call. There is nothing to invoke, so pretending there is would be the original
 *       defect again with more words.</li>
 * </ul>
 *
 * <p>Both are therefore restricted to {@link #NONE} with an error message that names the endpoint to
 * use instead, rather than silently accepting an enforcement and discarding it.
 *
 * <p><strong>Society-hub content is the counter-example, added later.</strong> The five society
 * kinds accept {@link #HIDE_CONTENT} because a verb was <em>built</em> for them —
 * {@code SocietyContentModerationService.remove}. Filing without it would have been the worse half
 * of the same defect: a queue that finally receives complaints about a recommendation naming a real
 * tradesman's mobile number, and still cannot take it down.
 */
public final class ReportEnforcement {

    private ReportEnforcement() {
    }

    /**
     * Decide the complaint and touch nothing. The honest default, and the only legal value when the
     * report is being dismissed — a dismissal that took something down would be a contradiction.
     */
    public static final String NONE = "none";

    /**
     * Take the reported content off the public site. For a listing this is
     * {@code PropertyModerationService.flag}, which sets {@code status='flagged'} <em>and</em> a
     * flag reason: the status is what removes it from every public read, the reason is what the
     * owner and the next moderator actually read, and neither alone does the job.
     */
    public static final String HIDE_CONTENT = "hide_content";

    /**
     * Suspend the reported account — {@code UserAdminService.archive}, the same soft-delete an
     * admin drives from the users screen, so a suspension raised from the abuse queue and one
     * raised by hand are the same row in the same state and are undone by the same restore.
     */
    public static final String SUSPEND_ACCOUNT = "suspend_account";

    private static final Set<String> ALL = Set.of(NONE, HIDE_CONTENT, SUSPEND_ACCOUNT);

    /** What may be done to each reportable kind. See the class Javadoc for the two empty ones. */
    private static final Set<String> FOR_PROPERTY = Set.of(NONE, HIDE_CONTENT);
    private static final Set<String> FOR_USER = Set.of(NONE, SUSPEND_ACCOUNT);
    private static final Set<String> FOR_SOCIETY_CONTENT = Set.of(NONE, HIDE_CONTENT);
    private static final Set<String> DECIDE_ONLY = Set.of(NONE);

    /** True if {@code value} is one of the three enforcements. */
    public static boolean isValid(String value) {
        return ALL.contains(value);
    }

    /** The enforcements that can be carried out against {@code targetType}. */
    public static Set<String> forTarget(String targetType) {
        if (ReportTargetTypes.isSocietyContent(targetType)) {
            return FOR_SOCIETY_CONTENT;
        }
        return switch (targetType) {
            case ReportTargetTypes.PROPERTY -> FOR_PROPERTY;
            case ReportTargetTypes.USER -> FOR_USER;
            default -> DECIDE_ONLY;
        };
    }

    /** True if {@code enforcement} can be carried out against {@code targetType}. */
    public static boolean isSupported(String targetType, String enforcement) {
        return forTarget(targetType).contains(enforcement);
    }

    /**
     * Why an unsupported enforcement was refused, phrased for the moderator who asked for it.
     *
     * <p>It names the endpoint that <em>can</em> do the job where one exists. A 422 that only says
     * "not allowed" would leave the moderator believing the platform cannot take a fake review down
     * at all, which is not true — it is one screen away.
     */
    public static String refusalFor(String targetType, String enforcement) {
        String base = "'%s' cannot be carried out against a %s from the report queue."
                .formatted(enforcement, targetType);
        return switch (targetType) {
            case ReportTargetTypes.REVIEW -> base
                    + " Take a review down with PATCH /reviews/{id}/status (status=rejected),"
                    + " which also removes it from the rating average.";
            case ReportTargetTypes.POST -> base
                    + " Share-flat posts have no moderation verb yet; decide the report and raise"
                    + " the post separately.";
            default -> base + " Expected one of " + forTarget(targetType) + ".";
        };
    }
}
