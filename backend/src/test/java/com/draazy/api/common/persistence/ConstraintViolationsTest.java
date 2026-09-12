package com.draazy.api.common.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.SQLException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * The shared constraint-name matcher behind every "you already have one of those" 409 — D170.
 *
 * <p><strong>The asymmetry being asserted.</strong> Every case below is really one question: when
 * the matcher is unsure, which way does it fall? It must fall to {@code false}, because the caller's
 * {@code else} branch rethrows. A false negative turns a business rule into a 500 — loud, logged,
 * fixed. A false positive tells a caller their duplicate was refused when in truth a foreign key
 * broke, and that defect never reaches anybody. Only the second is worth engineering against, and
 * every test here is a variation on it.
 *
 * <p>Plain JUnit: the class is two lines with no collaborators, and the driver messages are quoted
 * verbatim from PostgreSQL so the substring match is proved against the shape it will really meet.
 */
@DisplayName("D170 — a violation is matched by constraint name, and anything else is not ours")
class ConstraintViolationsTest {

    private static final String INDEX = "uq_conversations_pair_property";

    /** PostgreSQL's 23505 text, as the JDBC driver surfaces it. */
    private static final String DUPLICATE_KEY =
            "ERROR: duplicate key value violates unique constraint \"" + INDEX + "\"\n"
                    + "  Detail: Key (seeker_id, owner_id, property_id)=(0f0e..., 1a2b..., 3c4d...)"
                    + " already exists.";

    /** The case that used to be answered with a confident, wrong 409. */
    private static final String FOREIGN_KEY =
            "ERROR: insert or update on table \"conversations\" violates foreign key constraint "
                    + "\"conversations_property_id_fkey\"\n"
                    + "  Detail: Key (property_id)=(3c4d...) is not present in table \"properties\".";

    @Test
    @DisplayName("the collision the write was guarding against is recognised")
    void theExpectedConstraintMatches() {
        assertThat(ConstraintViolations.isOn(violation(DUPLICATE_KEY), INDEX)).isTrue();
    }

    /**
     * The D170 bug in one assertion. A genuine referential defect must not be dressed up as "you
     * already have a conversation with this owner" — before the fix, this returned {@code true} for
     * every message because nothing was compared at all.
     */
    @Test
    @DisplayName("a foreign key failure on the same table is not ours")
    void aForeignKeyFailureIsNotOurs() {
        assertThat(ConstraintViolations.isOn(violation(FOREIGN_KEY), INDEX)).isFalse();
    }

    /**
     * Two partial unique indexes guard the same table — the property-scoped pair and the general
     * one — and each catch block translates only its own. Colliding on the other means the write did
     * something its author did not anticipate, which is a 500.
     */
    @Test
    @DisplayName("a different unique index on the same table is not ours either")
    void anotherUniqueIndexIsNotOurs() {
        String other = DUPLICATE_KEY.replace(INDEX, "uq_conversations_pair_general");

        assertThat(ConstraintViolations.isOn(violation(other), INDEX)).isFalse();
    }

    /**
     * A driver that gives no message must not be read as a match. Falling to {@code false} makes
     * the caller rethrow, which surfaces the violation instead of inventing an explanation for it.
     */
    @Test
    @DisplayName("a cause with no message is not a match")
    void aMessagelessCauseIsNotAMatch() {
        DataIntegrityViolationException violation =
                new DataIntegrityViolationException("could not execute statement",
                        new SQLException((String) null, "23505"));

        assertThat(ConstraintViolations.isOn(violation, INDEX)).isFalse();
    }

    /**
     * Spring's {@code getMostSpecificCause()} falls back to the exception itself when there is no
     * cause at all, so the matcher must survive that rather than throw — a matcher that throws
     * inside a catch block replaces one failure with a less informative one.
     */
    @Test
    @DisplayName("a violation with no nested cause is handled, not thrown on")
    void aCauselessViolationIsHandled() {
        assertThat(ConstraintViolations.isOn(new DataIntegrityViolationException(INDEX), INDEX))
                .isTrue();
        assertThat(ConstraintViolations.isOn(new DataIntegrityViolationException("boom"), INDEX))
                .isFalse();
    }

    /**
     * The name is read from the driver's <em>most specific</em> cause, not from Spring's own
     * wrapper text — the wrapper says "could not execute statement" and nothing else, so a matcher
     * that looked at {@code getMessage()} would never match anything.
     */
    private static DataIntegrityViolationException violation(String driverMessage) {
        return new DataIntegrityViolationException("could not execute statement",
                new SQLException(driverMessage, "23505"));
    }
}
