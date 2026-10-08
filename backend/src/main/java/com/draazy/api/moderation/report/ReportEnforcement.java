package com.draazy.api.moderation.report;

import java.util.Set;

/** What a moderator did to the reported target, applied with the triage decision in one transaction. */
public final class ReportEnforcement {

    private ReportEnforcement() {
    }

    /** Decide the complaint and touch nothing; the only legal value when the report is dismissed. */
    public static final String NONE = "none";

    /** Take content off the public site; a listing needs both status 'flagged' and a flag reason. */
    public static final String HIDE_CONTENT = "hide_content";

    /** Suspend via the same soft-delete as the users screen, so one restore undoes it. */
    public static final String SUSPEND_ACCOUNT = "suspend_account";

    private static final Set<String> ALL = Set.of(NONE, HIDE_CONTENT, SUSPEND_ACCOUNT);

    /** What may be done to each reportable kind. See the class Javadoc for the two empty ones. */
    private static final Set<String> FOR_PROPERTY = Set.of(NONE, HIDE_CONTENT);
    private static final Set<String> FOR_USER = Set.of(NONE, SUSPEND_ACCOUNT);
    private static final Set<String> DECIDE_ONLY = Set.of(NONE);

    /** True if {@code value} is one of the three enforcements. */
    public static boolean isValid(String value) {
        return ALL.contains(value);
    }

    /** The enforcements that can be carried out against {@code targetType}. */
    public static Set<String> forTarget(String targetType) {
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

    /** Names the endpoint that can do the job, so the moderator isn't told the platform cannot act. */
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
