package com.draazy.api.provider;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.payments.CheckoutTtl;
import com.draazy.api.provider.cashfree.CashfreeProperties;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A missing field on an outbound vendor call is invisible until a customer outlasts the TTL and
 * pays a row the sweep already retired — for rent, a double charge. Asserts the payload directly.
 */
@DisplayName("D169 — the Cashfree order carries an expiry derived from the shared TTL")
class CashfreeOrderExpiryTest {

    private static final Instant NOW = Instant.parse("2026-03-14T09:30:00Z");

    /** Stated rather than read from the package-private {@code CheckoutTtl.DEFAULT_MINUTES}. */
    private static final CheckoutTtl TTL = new CheckoutTtl(45);

    /** Before D169 the key was absent and Cashfree's account default — days — applied instead. */
    @Test
    @DisplayName("the body carries order_expiry_time")
    void theOrderIsGivenAnExpiry() {
        assertThat(body()).containsKey("order_expiry_time");
    }

    /** Compared against the TTL object's own answer, so a second hard-coded number fails here. */
    @Test
    @DisplayName("the expiry is the shared TTL's look-forward, not a number of its own")
    void theExpiryComesFromTheSharedTtl() {
        Instant sent = Instant.from(
                DateTimeFormatter.ISO_OFFSET_DATE_TIME.parse((String) body().get("order_expiry_time")));

        assertThat(sent).isEqualTo(TTL.expiryFrom(NOW));
    }

    /** Stated on the provider side too: this is the window a reader of this package sees. */
    @Test
    @DisplayName("the order stops being payable when the sweep would retire the row")
    void theTwoWindowsCloseTogether() {
        Instant sent = Instant.from(
                DateTimeFormatter.ISO_OFFSET_DATE_TIME.parse((String) body().get("order_expiry_time")));

        // The row created at NOW is swept once the cutoff has moved past it.
        assertThat(TTL.cutoffFrom(sent)).isEqualTo(NOW);
    }

    /** Literal, not round-trip: a format Cashfree refuses would round-trip perfectly. */
    @Test
    @DisplayName("the expiry is ISO-8601 UTC at seconds precision")
    void theExpiryIsFormattedForTheVendor() {
        assertThat(body().get("order_expiry_time")).isEqualTo("2026-03-14T10:15:00Z");
    }

    /** {@code Instant.now()} carries nanoseconds in production, so this is the real path. */
    @Test
    @DisplayName("sub-second precision is truncated rather than sent")
    void nanosecondsAreTruncated() {
        Map<String, Object> body = CashfreePaymentGateway.orderRequest(
                "dz_1", 2499L, "sub_1", "cust_1", "9800000000",
                Instant.parse("2026-03-14T10:15:00.123456789Z"), null);

        assertThat(body.get("order_expiry_time")).isEqualTo("2026-03-14T10:15:00Z");
    }

    /** Adding a field must not have dropped or renamed one — nothing else covers this payload. */
    @Test
    @DisplayName("the fields the order already needed are still there")
    void theExistingFieldsSurvive() {
        Map<String, Object> body = body();

        assertThat(body.get("order_id")).isEqualTo("dz_1");
        assertThat(body.get("order_amount")).isEqualTo(2499L);
        assertThat(body.get("order_currency")).isEqualTo("INR");
        assertThat(body.get("order_note")).isEqualTo("sub_1");
        assertThat(body.get("customer_details"))
                .isEqualTo(Map.of("customer_id", "cust_1", "customer_phone", "9800000000"));
    }

    /** Absent must stay absent: the vendor may reject a blank value, but reads an omitted key as
     * "use the dashboard endpoint", which is how every deployment runs. */
    @Test
    @DisplayName("notify_url is omitted when unconfigured and sent when set")
    void theNotifyUrlIsOptional() {
        assertThat(body()).doesNotContainKey("order_meta");
        assertThat(CashfreePaymentGateway.orderRequest(
                "dz_1", 2499L, "sub_1", "cust_1", "9800000000", TTL.expiryFrom(NOW), "   "))
                .doesNotContainKey("order_meta");

        Map<String, Object> body = CashfreePaymentGateway.orderRequest(
                "dz_1", 2499L, "sub_1", "cust_1", "9800000000", TTL.expiryFrom(NOW),
                "https://tunnel.example/webhooks/cashfree/payment");

        assertThat(body.get("order_meta")).isEqualTo(
                Map.of("notify_url", "https://tunnel.example/webhooks/cashfree/payment"));
    }

    /**
     * The test above bypasses the guard by passing a raw string, so without this one it is
     * unexecuted code. Constructing directly is sound — the constructor dereferences no collaborator.
     */
    @Test
    @DisplayName("a notify url that is not absolute https refuses to start")
    void aBadNotifyUrlIsABootFailure() {
        for (String rejected : new String[] {
                "http://tunnel.example/hook",  // cleartext settlement data
                "/webhooks/cashfree/payment",  // relative: no host to post to
                "https:///hook",               // https, but still no host
                "not a url"}) {
            assertThatThrownBy(() -> gatewayWithNotifyUrl(rejected))
                    .as("notify url %s", rejected)
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("absolute https URL");
        }
    }

    /**
     * Blank is the deployed default ("use the dashboard endpoint"), and the scheme is
     * case-insensitive per RFC 3986 — a guard meant to catch a typo must not invent one.
     */
    @Test
    @DisplayName("blank, absent and upper-case https all start cleanly")
    void agoodNotifyUrlIsAccepted() {
        for (String accepted : new String[] {
                null, "", "   ", "https://sandbox.draazy.com/api/webhooks/cashfree/payment",
                "HTTPS://sandbox.draazy.com/api/webhooks/cashfree/payment"}) {
            assertThatCode(() -> gatewayWithNotifyUrl(accepted))
                    .as("notify url %s", accepted)
                    .doesNotThrowAnyException();
        }
    }

    private static CashfreePaymentGateway gatewayWithNotifyUrl(String notifyUrl) {
        return new CashfreePaymentGateway(null, TTL,
                new CashfreeProperties(true, null, null, null, notifyUrl));
    }

    private static Map<String, Object> body() {
        return CashfreePaymentGateway.orderRequest(
                "dz_1", 2499L, "sub_1", "cust_1", "9800000000", TTL.expiryFrom(NOW), null);
    }
}
