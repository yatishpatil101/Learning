package com.draazy.api.provider;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.provider.CashfreePaymentGateway.OrderResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

// A resumed checkout must never hand out a session for an order that can no longer be paid.
@DisplayName("A closed Cashfree checkout is resumed only while its order is ACTIVE")
class CashfreeOrderResumeTest {

    @Test
    @DisplayName("an ACTIVE order yields its session")
    void activeOrderResumes() {
        assertThat(CashfreePaymentGateway.resumable(new OrderResponse("dz_1", "sess_1", "ACTIVE")))
                .contains("sess_1");
    }

    @Test
    @DisplayName("a PAID, EXPIRED or TERMINATED order yields nothing, so no second payment is taken")
    void closedOrdersDoNot() {
        for (String status : new String[] {"PAID", "EXPIRED", "TERMINATED", "TERMINATION_REQUESTED"}) {
            assertThat(CashfreePaymentGateway.resumable(new OrderResponse("dz_1", "sess_1", status)))
                    .as(status).isEmpty();
        }
    }

    @Test
    @DisplayName("a reply with no session or no body yields nothing")
    void brokenRepliesDoNot() {
        assertThat(CashfreePaymentGateway.resumable(new OrderResponse("dz_1", " ", "ACTIVE"))).isEmpty();
        assertThat(CashfreePaymentGateway.resumable(null)).isEmpty();
    }
}
