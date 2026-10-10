package com.draazy.api.provider.cashfree;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.provider.cashfree.WebhookSignature.Verification;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.mock.env.MockEnvironment;

/** The header carries no unit and Cashfree sends seconds while fixtures sign millis; signer and verifier
 * are the same object, so agreement proves nothing about which unit is real. */
@DisplayName("the webhook freshness window accepts the unit Cashfree actually sends")
class WebhookFreshnessTest {

    private static final String SECRET = "test-secret-not-the-committed-default";
    private static final String BODY = "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\"}";
    private static final byte[] BODY_BYTES = BODY.getBytes(StandardCharsets.UTF_8);

    /** The environment is only consulted when the secret is the committed default; this is not. */
    private final WebhookSignature signature =
            new WebhookSignature(SECRET, false, new MockEnvironment());

    /** A correctly signed callback in Cashfree's own unit (seconds) is accepted; milliseconds stay valid
     * because every fixture in this suite signs with them. */
    @ParameterizedTest(name = "{0} verifies")
    @CsvSource({"epoch seconds,1000", "epoch milliseconds,1"})
    void aFreshTimestampVerifies(String unit, long divisor) {
        String timestamp = String.valueOf(System.currentTimeMillis() / divisor);

        assertThat(signature.verify(signature.sign(timestamp, BODY), timestamp, BODY_BYTES))
                .isEqualTo(Verification.VERIFIED);
    }

    /** A signature over a different body is not rescued by a fresh timestamp. */
    @Test
    @DisplayName("a valid timestamp does not excuse a wrong signature")
    void theHmacStillHasToMatch() {
        String timestamp = String.valueOf(System.currentTimeMillis() / 1000L);

        assertThat(signature.verify(signature.sign(timestamp, "{}"), timestamp, BODY_BYTES))
                .isEqualTo(Verification.MISMATCH);
    }

    /** The sentAt < 0 guard's one killing value is now + Long.MIN_VALUE, but now is read inside the
     * verifier, so only the ordinary negative case is testable. */
    @Test
    @DisplayName("a negative timestamp is never fresh")
    void negativeIsRefused() {
        for (String timestamp : new String[] {"-1", String.valueOf(Long.MIN_VALUE)}) {
            assertThat(signature.verify(signature.sign(timestamp, BODY), timestamp, BODY_BYTES))
                    .as("timestamp %s", timestamp)
                    .isEqualTo(Verification.STALE);
        }
    }

    @Test
    @DisplayName("the MAC covers the bytes on the wire, multi-byte characters included")
    void multiByteBodiesVerify() {
        String timestamp = String.valueOf(System.currentTimeMillis() / 1000L);
        String body = "{\"payment_amount\":\"₹590\"}";

        assertThat(signature.verify(signature.sign(timestamp, body), timestamp,
                body.getBytes(StandardCharsets.UTF_8))).isEqualTo(Verification.VERIFIED);
    }

    /** The one non-self-referential assertion: the expected value is computed outside this codebase, so
     * reversing the concatenation or switching to hex must disagree. */
    @Test
    @DisplayName("the MAC is Base64 HMAC-SHA256 over timestamp + body, in that order")
    void theWireFormatIsTheVendorsOwn() {
        assertThat(signature.sign("1771000000", BODY))
                .isEqualTo("MFc5Evb/LIyj+Nfm11rW5pqXAB4LjBD4QHo3gA1mC2g=");
    }

    /** Pins the window's size, which the hour-old test does not; the five-second margin is because now is
     * read inside the verifier, so an exact boundary is a coin flip on CI. */
    @Test
    @DisplayName("the window is five minutes wide in seconds and in milliseconds")
    void theWindowEdgesHold() {
        long nowMillis = System.currentTimeMillis();
        long skewMillis = 5 * 60 * 1000L;
        long marginMillis = 5_000L;

        for (String fresh : new String[] {
                String.valueOf(nowMillis - (skewMillis - marginMillis)),
                String.valueOf((nowMillis - (skewMillis - marginMillis)) / 1000L)}) {
            assertThat(signature.verify(signature.sign(fresh, BODY), fresh, BODY_BYTES))
                    .as("just inside the window: %s", fresh)
                    .isEqualTo(Verification.VERIFIED);
        }

        for (String expired : new String[] {
                String.valueOf(nowMillis - (skewMillis + marginMillis)),
                String.valueOf((nowMillis - (skewMillis + marginMillis)) / 1000L)}) {
            assertThat(signature.verify(signature.sign(expired, BODY), expired, BODY_BYTES))
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

        assertThat(signature.verify(null, timestamp, BODY_BYTES)).isEqualTo(Verification.MISSING_HEADER);
        assertThat(signature.verify(valid, null, BODY_BYTES)).isEqualTo(Verification.MISSING_HEADER);
        assertThat(signature.verify(valid, timestamp, null)).isEqualTo(Verification.MISSING_HEADER);
        assertThat(signature.verify(valid, "not-a-number", BODY_BYTES)).isEqualTo(Verification.MALFORMED);
        assertThat(signature.verify("not~base64!", timestamp, BODY_BYTES))
                .isEqualTo(Verification.MALFORMED);
    }
}
