package com.punenest.api.moderation.report;

/**
 * The {@code reports.target_type} vocabulary — what kind of thing is being reported.
 *
 * <p>Feature-owned {@code String} constants rather than a Java enum, per api-standards.md §7.1 and
 * the schema's "text + CHECK" policy: adding a fifth reportable kind should be one ALTER and one
 * constant, not a recompile of everything that touches the type.
 */
public final class ReportTargetTypes {

    private ReportTargetTypes() {
    }

    /**
     * A listing. Note the vocabulary gap the client has to bridge: the frontend's
     * {@code ReportModal} calls this kind {@code listing}, while the contract, the schema and this
     * API call it {@code property}. The API keeps the contract's word.
     */
    public static final String PROPERTY = "property";

    /** A person — impersonation, fraud, abusive conduct. */
    public static final String USER = "user";

    /** A review, typically as fake or defamatory. */
    public static final String REVIEW = "review";

    /** A share-flat / flatmate post. */
    public static final String POST = "post";

    /** True if {@code value} is one of the four reportable kinds. */
    public static boolean isValid(String value) {
        return PROPERTY.equals(value) || USER.equals(value)
                || REVIEW.equals(value) || POST.equals(value);
    }
}
