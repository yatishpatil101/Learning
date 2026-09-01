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

    /**
     * A society-hub recommendation or tip.
     *
     * <p>The five society kinds below are separate vocabulary words rather than one
     * {@code society_content}, because {@code target_id} means nothing without knowing which table
     * it indexes. A moderator upholding a complaint has to remove <em>that row</em>, and one
     * catch-all type would mean five lookups per decision with the id ambiguity that implies.
     *
     * <p>A society <em>review</em> is deliberately not a sixth: it is already reportable as
     * {@link #REVIEW} and already has its own takedown at {@code PATCH /reviews/{id}/status}. A
     * second word for the same thing would split the queue in half.
     */
    public static final String SOCIETY_CONTRIBUTION = "society_contribution";

    /** A reply on a society-hub recommendation. */
    public static final String SOCIETY_REPLY = "society_reply";

    /** A question on a society hub. */
    public static final String SOCIETY_QUESTION = "society_question";

    /** An answer to a society-hub question. */
    public static final String SOCIETY_ANSWER = "society_answer";

    /** A society noticeboard item. */
    public static final String SOCIETY_BOARD = "society_board";

    /** True if {@code value} is one of the five kinds of society-hub content. */
    public static boolean isSocietyContent(String value) {
        return SOCIETY_CONTRIBUTION.equals(value) || SOCIETY_REPLY.equals(value)
                || SOCIETY_QUESTION.equals(value) || SOCIETY_ANSWER.equals(value)
                || SOCIETY_BOARD.equals(value);
    }

    /** True if {@code value} is one of the reportable kinds. */
    public static boolean isValid(String value) {
        return PROPERTY.equals(value) || USER.equals(value)
                || REVIEW.equals(value) || POST.equals(value)
                || isSocietyContent(value);
    }
}
