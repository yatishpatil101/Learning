package com.draazy.api.provider;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.common.payments.CheckoutTtl;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The {@code order_expiry_time} Cashfree is told to close the order at — D169.
 *
 * <p><strong>Why this is worth a test at all.</strong> A missing field on an outbound vendor call is
 * invisible: the order is created, the customer pays, everything looks correct. What was wrong is
 * only observable when a customer takes longer than the TTL — our sweep had retired the row while
 * Cashfree still considered the order payable, so the payment landed against nothing. For rent that
 * is a double charge, because the retired row frees the month.
 *
 * <p><strong>Why it asserts a map and not an HTTP call.</strong> {@code CashfreeClient}'s
 * constructor is package-private in another package and there is no mocking framework on the
 * classpath, so the body is assembled by a package-private {@code orderRequest} that this test —
 * deliberately in {@code com.draazy.api.provider} — can call directly. That keeps the assertion on
 * the thing that was wrong (the payload) rather than on transport nobody changed.
 */
@DisplayName("D169 — the Cashfree order carries an expiry derived from the shared TTL")
class CashfreeOrderExpiryTest {

    private static final Instant NOW = Instant.parse("2026-03-14T09:30:00Z");

    /**
     * Forty-five is stated rather than read from {@code CheckoutTtl.DEFAULT_MINUTES}, which is
     * package-private in {@code common.payments} and stays that way — the default is that class's
     * business. What matters here is that the expiry is <em>this</em> object's answer for whatever
     * TTL it holds, which is what the assertions below compare against.
     */
    private static final CheckoutTtl TTL = new CheckoutTtl(45);

    /**
     * The regression proper. Before D169 the body had no {@code order_expiry_time} key at all, and
     * Cashfree's account default — days — applied instead.
     */
    @Test
    @DisplayName("the body carries order_expiry_time")
    void theOrderIsGivenAnExpiry() {
        assertThat(body()).containsKey("order_expiry_time");
    }

    /**
     * The anti-drift assertion, and the reason this test imports {@link CheckoutTtl} rather than
     * writing {@code NOW.plusSeconds(2700)}. The expiry is asserted to be the TTL object's own
     * answer, so re-deriving it from a second hard-coded number anywhere in the gateway fails here.
     */
    @Test
    @DisplayName("the expiry is the shared TTL's look-forward, not a number of its own")
    void theExpiryComesFromTheSharedTtl() {
        Instant sent = Instant.from(
                DateTimeFormatter.ISO_OFFSET_DATE_TIME.parse((String) body().get("order_expiry_time")));

        assertThat(sent).isEqualTo(TTL.expiryFrom(NOW));
    }

    /**
     * The sweep and the gateway close the same window. Stated here as well as in
     * {@code CheckoutTtlTest} because this is the side a reader of the provider package sees: an
     * order opened alongside its row stops being payable exactly when the sweep would retire it.
     */
    @Test
    @DisplayName("the order stops being payable when the sweep would retire the row")
    void theTwoWindowsCloseTogether() {
        Instant sent = Instant.from(
                DateTimeFormatter.ISO_OFFSET_DATE_TIME.parse((String) body().get("order_expiry_time")));

        // The row created at NOW is swept once the cutoff has moved past it.
        assertThat(TTL.cutoffFrom(sent)).isEqualTo(NOW);
    }

    /**
     * Cashfree parses this string; nanoseconds and a local offset are both things a vendor parser is
     * entitled to reject, and neither carries information. Asserted literally because "it round
     * trips" would pass for a format Cashfree refuses.
     */
    @Test
    @DisplayName("the expiry is ISO-8601 UTC at seconds precision")
    void theExpiryIsFormattedForTheVendor() {
        assertThat(body().get("order_expiry_time")).isEqualTo("2026-03-14T10:15:00Z");
    }

    /**
     * Nanoseconds on the input must not reach the wire. {@code Instant.now()} carries them in
     * production, so this is the real path rather than a contrived one.
     */
    @Test
    @DisplayName("sub-second precision is truncated rather than sent")
    void nanosecondsAreTruncated() {
        Map<String, Object> body = CashfreePaymentGateway.orderRequest(
                "dz_1", 2499L, "sub_1", "cust_1", "9800000000",
                Instant.parse("2026-03-14T10:15:00.123456789Z"));

        assertThat(body.get("order_expiry_time")).isEqualTo("2026-03-14T10:15:00Z");
    }

    /**
     * The rest of the body is unchanged by D169. Asserted so that adding the expiry cannot have
     * quietly dropped or renamed a field the vendor requires — the failure mode of editing a payload
     * that nothing else covers.
     */
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

    private static Map<String, Object> body() {
        return CashfreePaymentGateway.orderRequest(
                "dz_1", 2499L, "sub_1", "cust_1", "9800000000", TTL.expiryFrom(NOW));
    }
}
