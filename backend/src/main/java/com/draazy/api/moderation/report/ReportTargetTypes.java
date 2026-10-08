package com.draazy.api.moderation.report;

/** The {@code reports.target_type} vocabulary; String constants so a new kind is one ALTER and one constant. */
public final class ReportTargetTypes {

    private ReportTargetTypes() {
    }

    /** The frontend says {@code listing}; the contract and schema say {@code property}. */
    public static final String PROPERTY = "property";

    /** A person — impersonation, fraud, abusive conduct. */
    public static final String USER = "user";

    /** A review, typically as fake or defamatory. */
    public static final String REVIEW = "review";

    /** A share-flat / flatmate post. */
    public static final String POST = "post";

    /** True if {@code value} is one of the reportable kinds. */
    public static boolean isValid(String value) {
        return PROPERTY.equals(value) || USER.equals(value)
                || REVIEW.equals(value) || POST.equals(value);
    }
}
