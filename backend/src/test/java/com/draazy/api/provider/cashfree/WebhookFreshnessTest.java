package com.draazy.api.provider.cashfree;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.provider.cashfree.WebhookSignature.Verification;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

/**
 * The header carries no unit and Cashfree sends seconds while the fixtures sign millis. Signer and
 * verifier are the same object, so the suite agreed with itself no matter which unit was real.
 */
@DisplayName("the webhook freshness window accepts the unit Cashfree actually sends")
class WebhookFreshnessTest {

    private static final String SECRET = "test-secret-not-the-committed-default";
    private static final String BODY = "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\"}";

    /** The environment is only consulted when the secret is the committed default; this is not. */
    private final WebhookSignature signature =
            new WebhookSignature(SECRET, false, new MockEnvironment());

    /** The regression proper: a correctly signed callback in Cashfree's own unit is accepted. */
    @Test
    @DisplayName("epoch seconds verifies")
    void secondsAreFresh() {
        String timestamp = String.valueOf(System.currentTimeMillis() / 1000L);

        assertThat(signature.verify(signature.sign(timestamp, BODY), timestamp, BODY))
                .isEqualTo(Verification.VERIFIED);
    }

    /** Milliseconds stay valid, because every fixture in this suite signs with them. */
    @Test
    @DisplayName("epoch milliseconds still verifies")
    void millisecondsAreFresh() {
        String timestamp = String.valueOf(System.currentTimeMillis());

        assertThat(signature.verify(signature.sign(timestamp, BODY), timestamp, BODY))
                .isEqualTo(Verification.VERIFIED);
    }

    /** Accepting both readings must not have widened the window in either. */
    @Test
    @DisplayName("an hour-old timestamp is refused in either unit")
    void staleIsRefusedInBothUnits() {
        long hourAgoMillis = System.currentTimeMillis() - 3_600_000L;

        for (String timestamp : new String[] {
                String.valueOf(hourAgoMillis), String.valueOf(hourAgoMillis / 1000L)}) {
            assertThat(signature.verify(signature.sign(timestamp, BODY), timestamp, BODY))
                    .as("timestamp %s", timestamp)
                    .isEqualTo(Verification.STALE);
        }
    }

    /** A signature over a different body is not rescued by a fresh timestamp. */
    @Test
    @DisplayName("a valid timestamp does not excuse a wrong signature")
    void theHmacStillHasToMatch() {
        String timestamp = String.valueOf(System.currentTimeMillis() / 1000L);

        assertThat(signature.verify(signature.sign(timestamp, "{}"), timestamp, BODY))
                .isEqualTo(Verification.MISMATCH);
    }

    /**
     * The ordinary negative case only. The {@code sentAt < 0} guard's one killing value is
     * {@code now + Long.MIN_VALUE}, and {@code now} is read inside the verifier — untestable.
     */
    @Test
    @DisplayName("a negative timestamp is never fresh")
    void negativeIsRefused() {
        for (String timestamp : new String[] {"-1", String.valueOf(Long.MIN_VALUE)}) {
            assertThat(signature.verify(signature.sign(timestamp, BODY), timestamp, BODY))
                    .as("timestamp %s", timestamp)
                    .isEqualTo(Verification.STALE);
        }
    }

    /**
     * The one assertion not self-referential: the expected value was computed outside this codebase,
     * so reversing the concatenation or switching to hex has to disagree with something.
     */
    @Test
    @DisplayName("the MAC is Base64 HMAC-SHA256 over timestamp + body, in that order")
    void theWireFormatIsTheVendorsOwn() {
        assertThat(signature.sign("1771000000", BODY))
                .isEqualTo("MFc5Evb/LIyj+Nfm11rW5pqXAB4LjBD4QHo3gA1mC2g=");
    }

    /**
     * Pins the window's <em>size</em>, which the hour-old test does not. The five-second margin is
     * because {@code now} is read inside the verifier, so an exact boundary is a coin flip on CI.
     */
    @Test
    @DisplayName("the window is five minutes wide in seconds and in milliseconds")
    void theWindowEdgesHold() {
        long nowMillis = System.currentTimeMillis();
        long skewMillis = 5 * 60 * 1000L;
        long marginMillis = 5_000L;

        for (String fresh : new String[] {
                String.valueOf(nowMillis - (skewMillis - marginMillis)),
                String.valueOf((nowMillis - (skewMillis - marginMillis)) / 1000L)}) {
            assertThat(signature.verify(signature.sign(fresh, BODY), fresh, BODY))
                    .as("just inside the window: %s", fresh)
                    .isEqualTo(Verification.VERIFIED);
        }

        for (String expired : new String[] {
                String.valueOf(nowMillis - (skewMillis + marginMillis)),
                String.valueOf((nowMillis - (skewMillis + marginMillis)) / 1000L)}) {
            assertThat(signature.verify(signature.sign(expired, BODY), expired, BODY))
                    .as("just outside the window: %s", expired)
                    .isEqualTo(Verification.STALE);
        }
    }

    /** Only {@link Verification#MISMATCH} means the key is wrong; an undifferentiated refusal sent
     * the last reader after a secret that was correct. */
    @Test
    @DisplayName("each refusal names its own cause")
    void theReasonsAreDistinct() {
        String timestamp = String.valueOf(System.currentTimeMillis() / 1000L);
        String valid = signature.sign(timestamp, BODY);

        assertThat(signature.verify(null, timestamp, BODY)).isEqualTo(Verification.MISSING_HEADER);
        assertThat(signature.verify(valid, null, BODY)).isEqualTo(Verification.MISSING_HEADER);
        assertThat(signature.verify(valid, timestamp, null)).isEqualTo(Verification.MISSING_HEADER);
        assertThat(signature.verify(valid, "not-a-number", BODY)).isEqualTo(Verification.MALFORMED);
        assertThat(signature.verify("not~base64!", timestamp, BODY))
                .isEqualTo(Verification.MALFORMED);
    }
}
