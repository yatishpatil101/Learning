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

// The two properties of `RateLimitLock` that are not visible from a race test.
// A concurrency test can only show that a limit held.
@DisplayName("RateLimitLock — the guarantees a race test cannot see")
class RateLimitLockTest {

    // The namespace lives in the high 32 bits and the key hash in the low 32, so two limits cannot collide however
    // unluckily their keys hash.
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

    // A negative `hashCode` must not bleed into the namespace half: without the mask, sign-extension would land the
    // id in another limit's namespace.
    @Test
    @DisplayName("a key that hashes negative stays inside its own namespace")
    void negativeHashesStayInTheirNamespace() {
        String negative = "9876500073";
        assertThat(negative.hashCode()).isNegative();

        long id = RateLimitLock.lockId(Limit.OTP_SEND, negative);

        assertThat(id >>> 32)
                .as("the high half is the namespace and nothing else")
                .isEqualTo(1L);
        assertThat(RateLimitLock.lockId(Limit.FLATMATE_INTEREST, negative) >>> 32)
                .isEqualTo(3L);
    }

    /** Same limit, same key, same id — the whole mechanism rests on this being stable. */
    @Test
    @DisplayName("the same limit and key always give the same id")
    void theIdIsStable() {
        assertThat(RateLimitLock.lockId(Limit.FLATMATE_INTEREST, "abc"))
                .isEqualTo(RateLimitLock.lockId(Limit.FLATMATE_INTEREST, "abc"));
    }

    // Outside a transaction the lock would be taken and released by the same autocommit statement, so it would guard
    // nothing and say nothing.
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
