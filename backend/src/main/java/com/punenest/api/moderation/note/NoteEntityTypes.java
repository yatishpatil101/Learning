package com.punenest.api.moderation.note;

/**
 * The {@code internal_notes.entity_type} vocabulary — what a note is attached to.
 *
 * <p>Feature-owned {@code String} constants rather than a Java enum, per api-standards.md §7.1 and
 * the schema's "text + CHECK" policy. The CHECK in {@code V90} and {@link #isValid(String)} are the
 * same list written twice on purpose: the database refuses a bad row even if a future caller
 * reaches the table another way, and the API refuses it with a 422 instead of a constraint
 * violation.
 *
 * <p><strong>The word is {@code property}, not {@code listing}</strong> — the same gap
 * {@code ReportTargetTypes} documents, and closed the same way. The frontend's note widget has said
 * {@code listing} since it was written; the contract, the schema and this API say {@code property}
 * everywhere else, and one vocabulary drifting into one column is how a filter quietly stops
 * matching half its rows. The client bridges it in its mapper, once, where it can be read.
 *
 * <p>Deliberately <em>not</em> the report vocabulary reused: {@code post} is reportable and does not
 * take notes, and {@code report} takes notes and is not reportable. Two lists that overlap in three
 * of four values are still two lists, and sharing one because it is currently shorter is how the
 * next kind gets added to the wrong one.
 */
public final class NoteEntityTypes {

    private NoteEntityTypes() {
    }

    /** A listing. The client's widget calls this {@code listing}; the wire does not. */
    public static final String PROPERTY = "property";

    /** A person. Notes about an account holder are in scope by decision (D29). */
    public static final String USER = "user";

    /** A review, typically annotating why it was taken down or left up. */
    public static final String REVIEW = "review";

    /** An abuse report — the note beside the triage decision. */
    public static final String REPORT = "report";

    /** True if {@code value} is one of the four kinds that take notes. */
    public static boolean isValid(String value) {
        return PROPERTY.equals(value) || USER.equals(value)
                || REVIEW.equals(value) || REPORT.equals(value);
    }
}
