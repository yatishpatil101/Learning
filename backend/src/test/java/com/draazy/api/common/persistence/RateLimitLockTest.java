package com.draazy.api.common.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.draazy.api.common.persistence.RateLimitLock.Limit;
import jakarta.persistence.EntityManager;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The two properties of {@link RateLimitLock} that are not visible from a race test.
 *
 * <p>A concurrency test can only show that a limit held. It cannot show <em>why</em> — and both of
 * the things that would silently stop it holding are invisible at runtime: two limits quietly
 * sharing one lock id, and a lock taken outside a transaction and released before it guards
 * anything. Neither produces an error, a slow query or a failed assertion anywhere else. They just
 * turn the protection off.
 */
@DisplayName("RateLimitLock — the guarantees a race test cannot see")
class RateLimitLockTest {

    /**
     * The namespace lives in the high 32 bits and the key hash in the low 32, so two limits cannot
     * collide however unluckily their keys hash.
     *
     * <p>Tested with the <em>same</em> key across every limit, which is the adversarial case: it is
     * the only input for which the low halves are guaranteed equal, so if the partition were dropped
     * — a missing shift, a mask that let the sign bit through — every id here would be identical and
     * an OTP send would queue behind a society lead.
     */
    @Test
    @DisplayName("no two limits can produce the same lock id, even for an identical key")
    void namespacesCannotCollide() {
        Set<Long> ids = new HashSet<>();
        for (Limit limit : Limit.values()) {
            ids.add(RateLimitLock.lockId(limit, "9876500073"));
        }
        assertThat(ids)
                .as("each Limit must occupy its own 32-bit namespace")
                .hasSize(Limit.values().length);
    }

    /**
     * A negative {@code hashCode} must not bleed into the namespace half.
     *
     * <p>{@code String.hashCode} is signed and negative for plenty of ordinary inputs, so without
     * the mask the sign-extension would flip every high bit and land the id in another limit's
     * namespace — the one bug in this class that only shows up for some keys.
     *
     * <p>The key is a real ten-digit mobile, not a contrived string, and it is chosen because it
     * genuinely hashes negative: that is what makes this a live defect rather than a theoretical
     * one. The {@code isNegative} assertion is the test's own premise and is asserted rather than
     * assumed, so a future JDK changing {@code String.hashCode} fails here — loudly, on the line
     * that says why — instead of quietly leaving the real assertion below testing nothing.
     */
    @Test
    @DisplayName("a key that hashes negative stays inside its own namespace")
    void negativeHashesStayInTheirNamespace() {
        String negative = "9876500073";
        assertThat(negative.hashCode()).isNegative();

        long id = RateLimitLock.lockId(Limit.OTP_SEND, negative);

        assertThat(id >>> 32)
                .as("the high half is the namespace and nothing else")
                .isEqualTo(1L);
        assertThat(RateLimitLock.lockId(Limit.SOCIETY_LEAD_SUBMIT, negative) >>> 32)
                .isEqualTo(2L);
    }

    /** Same limit, same key, same id — the whole mechanism rests on this being stable. */
    @Test
    @DisplayName("the same limit and key always give the same id")
    void theIdIsStable() {
        assertThat(RateLimitLock.lockId(Limit.FLATMATE_INTEREST, "abc"))
                .isEqualTo(RateLimitLock.lockId(Limit.FLATMATE_INTEREST, "abc"));
    }

    /**
     * Outside a transaction the lock would be taken and released by the same autocommit statement,
     * so it would guard nothing and say nothing. This test runs with no transaction at all — which
     * is the default for a plain JUnit test — and asserts the loud failure, plus that the statement
     * is never issued: refusing before touching the database is what makes the failure a
     * misconfiguration rather than a mysterious no-op.
     */
    @Test
    @DisplayName("refuses to run outside a transaction rather than silently guarding nothing")
    void refusesWithoutATransaction() {
        EntityManager em = mock(EntityManager.class);

        assertThatThrownBy(() -> new RateLimitLock(em).holdUntilCommit(Limit.OTP_SEND, "9876500073"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("active transaction");

        verifyNoInteractions(em);
    }
}
