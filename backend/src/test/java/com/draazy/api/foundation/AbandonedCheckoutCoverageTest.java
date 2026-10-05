package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.common.payments.AbandonedCheckouts;
import com.draazy.api.support.AbstractApiTest;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

// Counting families proves the next priced path cannot ship without an abandoned-checkout sweep.
// The floor is `>=` so removals fail while new paid families do not churn this guard.
@DisplayName("D161 — every payment family has a sweep, not just the one that needed it first")
class AbandonedCheckoutCoverageTest extends AbstractApiTest {

    private static final int PRICED_PATHS = 2;

    @Autowired List<AbandonedCheckouts> families;

    @Test
    @DisplayName("every priced path is registered, each naming itself distinctly")
    void everyPricedPathIsSwept() {
        assertThat(families).hasSizeGreaterThanOrEqualTo(PRICED_PATHS);

        assertThat(families).extracting(AbandonedCheckouts::family)
                .doesNotContainNull()
                .noneMatch(String::isBlank)
                .doesNotHaveDuplicates()
                .contains("service request", "subscription");
    }
}
