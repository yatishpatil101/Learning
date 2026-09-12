package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.common.payments.AbandonedCheckouts;
import com.draazy.api.support.AbstractApiTest;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Every priced path registers a way out of its own abandoned checkouts — D161.
 *
 * <p><strong>Why a registry test rather than four more assertions.</strong> The defect D161 records
 * was not that any one sweep was wrong; it was that three of the four payment families never got one
 * at all, because the first was written for the family that needed it that week. Testing each
 * family's sweep proves the sweeps that exist work. Only counting them proves the next priced path
 * cannot ship without one — {@code AbandonedCheckoutSweep} iterates whatever is on the classpath, so
 * a family that forgets to implement the port is not a failure anywhere, it is silence.
 *
 * <p>The floor is deliberately {@code >=} rather than {@code ==}: this must fail when a family is
 * dropped, and must not fail when one is added correctly.
 */
@DisplayName("D161 — every payment family has a sweep, not just the one that needed it first")
class AbandonedCheckoutCoverageTest extends AbstractApiTest {

    /**
     * Service requests, subscriptions and boosts — the paths that open real orders.
     *
     * <p>Rent was the fourth until the rent-pay rail was withdrawn. It is gone from the count
     * rather than left in as a floor nobody can meet: a floor that outlives the family it counted
     * fails the build for a deliberate removal, which trains the next reader to edit the number
     * instead of reading the failure. If the rail ever ships, it ships with a sweep and this goes
     * back to four.
     */
    private static final int PRICED_PATHS = 3;

    @Autowired List<AbandonedCheckouts> families;

    @Test
    @DisplayName("all three priced paths are registered, each naming itself distinctly")
    void everyPricedPathIsSwept() {
        assertThat(families).hasSizeGreaterThanOrEqualTo(PRICED_PATHS);

        // The name is what a sweep failure is logged under, so a blank or duplicated one turns an
        // operator's "which family broke?" into a guess.
        assertThat(families).extracting(AbandonedCheckouts::family)
                .doesNotContainNull()
                .noneMatch(String::isBlank)
                .doesNotHaveDuplicates()
                .contains("service request", "subscription", "boost");
    }
}
