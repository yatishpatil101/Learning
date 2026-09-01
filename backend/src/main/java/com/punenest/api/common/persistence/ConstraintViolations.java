package com.punenest.api.common.persistence;

import org.springframework.dao.DataIntegrityViolationException;

/**
 * Whether a constraint violation is <em>the</em> constraint the caller was expecting (D170).
 *
 * <p><strong>The mistake this exists to stop.</strong> A write guarded by a partial unique index is
 * normally wrapped in a {@code try/catch} that turns the collision into a business 409 — "you
 * already have an unpaid order", "rent for this month is already in progress". But the same insert
 * can also trip a foreign key, a not-null, or a <em>different</em> unique index, and
 * {@link DataIntegrityViolationException} is one type for all of them. A catch block that translates
 * the exception rather than the constraint therefore answers a genuine defect with a confident,
 * wrong explanation: the caller is told the system is working as designed, and the real fault never
 * reaches the error log. Every catch block that translates a 23505 must therefore name the
 * constraint it is prepared to forgive.
 *
 * <p><strong>Why the check is a string match.</strong> JDBC exposes an SQLState (23505) but not the
 * name of the index that produced it; only the driver's own message carries that, and
 * {@link org.springframework.dao.DataAccessException#getMostSpecificCause()} is how Spring hands it
 * over. Matching a name we chose ourselves in a migration is narrow enough to be safe — the risk of
 * a false positive is another constraint being named as a substring of this one, which is a thing
 * the author of the migration controls.
 *
 * <p><strong>Why it is shared rather than copied a fourth time.</strong> Four services need the
 * identical two lines against four different index names — the only variable is the name, which is
 * already a constant at each call site. Three private copies had already diverged in their comments
 * while agreeing in their code, which is the state just before one of them is "simplified" into
 * catching everything again. There is nothing to configure and no policy to decide, so it is a
 * static utility rather than a bean.
 */
public final class ConstraintViolations {

    private ConstraintViolations() {
    }

    /**
     * Whether {@code violation} was raised by the constraint called {@code constraintName}.
     *
     * <p>Returns {@code false} for anything else, including a driver that gave no message at all —
     * so the caller's {@code else} branch rethrows, which is the safe direction. Mistaking our
     * constraint for someone else's turns a business rule into a 500 (visible, investigated);
     * mistaking someone else's for ours hides a bug behind a reassuring message (invisible), and
     * only the second failure mode is the one worth engineering against.
     *
     * @param violation      what the write threw
     * @param constraintName the index or constraint name exactly as the migration declares it
     */
    public static boolean isOn(DataIntegrityViolationException violation, String constraintName) {
        String cause = violation.getMostSpecificCause().getMessage();
        return cause != null && cause.contains(constraintName);
    }
}
