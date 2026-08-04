package com.punenest.api.identity.verification;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.provider.cashfree.WebhookSignature;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Contract + behaviour proof for the Aadhaar (DigiLocker) badge and its webhook.
 *
 * <p>The webhook tests deliberately compute a <em>real</em> HMAC via {@link WebhookSignature} rather
 * than stubbing verification out: a signature check that is only ever mocked is a signature check
 * nobody has run, and this is the one unauthenticated write in the application.
 */
class VerificationEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    IdentityVerificationRepository verifications;
    @Autowired
    WebhookSignature webhookSignature;

    private User user(String mobile) {
        User u = new User(mobile, "buyer");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** Start a flow and return its correlation {@code ref}. */
    private String start(User u) throws Exception {
        String json = mvc.perform(post(Routes.Verification.AADHAAR)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll("^.*?\"ref\":\"([^\"]+)\".*$", "$1");
    }

    private String successBody(String ref, String mobile, String identityHash) {
        return "{\"type\":\"DIGILOCKER_VERIFICATION_SUCCESS\",\"ref\":\"" + ref
                + "\",\"status\":\"SUCCESS\",\"data\":{\"maskedAadhaar\":\"XXXX XXXX 1234\","
                + "\"mobile\":\"" + mobile + "\",\"identityHash\":\"" + identityHash + "\"}}";
    }

    /** Deliver a correctly-signed webhook. */
    private void deliver(String body) throws Exception {
        String ts = String.valueOf(System.currentTimeMillis());
        mvc.perform(post(Routes.Webhooks.CASHFREE_DIGILOCKER)
                        .header("x-webhook-timestamp", ts)
                        .header("x-webhook-signature", webhookSignature.sign(ts, body))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());
    }

    // ---------------- GET / POST /me/verification/aadhaar ----------------

    @Test
    void getAadhaarStatus_returnsTheNoBadgeStateRatherThan404() throws Exception {
        User u = user("9830000001");

        mvc.perform(get(Routes.Verification.AADHAAR).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.badge").value(false))
                .andExpect(jsonPath("$.status").value(VerificationStatuses.NONE))
                .andExpect(jsonPath("$.verifiedAt").doesNotExist());
    }

    @Test
    void submitAadhaar_returns202WithAHandle_andPersistsThePendingRow() throws Exception {
        User u = user("9830000002");

        mvc.perform(post(Routes.Verification.AADHAAR).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.ref").exists())
                .andExpect(jsonPath("$.verificationUrl").exists())
                .andExpect(jsonPath("$.expiresAt").exists());

        IdentityVerification row = verifications.findByUserId(u.getId()).orElseThrow();
        assertThat(row.getStatus()).isEqualTo(VerificationStatuses.PENDING);
        assertThat(row.getSource()).isEqualTo(VerificationSources.DIGILOCKER);
        assertThat(row.isBadge()).isFalse();
    }

    @Test
    void verificationRoutesRequireAuthentication() throws Exception {
        mvc.perform(get(Routes.Verification.AADHAAR)).andExpect(status().isUnauthorized());
        mvc.perform(post(Routes.Verification.AADHAAR)).andExpect(status().isUnauthorized());
    }

    // ---------------- the webhook ----------------

    @Test
    void webhook_grantsTheBadge_storesOnlyTheMaskedLast4_andRecordsTheMobileMatch() throws Exception {
        User u = user("9830000003");
        String ref = start(u);

        deliver(successBody(ref, "9830000003", "hash-" + UUID.randomUUID()));

        IdentityVerification row = verifications.findByRef(ref).orElseThrow();
        assertThat(row.isBadge()).isTrue();
        assertThat(row.getStatus()).isEqualTo(VerificationStatuses.VERIFIED);
        assertThat(row.getMaskedAadhaar()).isEqualTo("XXXX XXXX 1234");
        assertThat(row.getMobileMatch()).isTrue();
        assertThat(row.getVerifiedAt()).isNotNull();
        assertThat(users.findById(u.getId()).orElseThrow().isAadhaarVerified()).isTrue();

        mvc.perform(get(Routes.Verification.AADHAAR).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.badge").value(true))
                .andExpect(jsonPath("$.status").value(VerificationStatuses.VERIFIED))
                .andExpect(jsonPath("$.source").value(VerificationSources.DIGILOCKER))
                .andExpect(jsonPath("$.maskedAadhaar").value("XXXX XXXX 1234"))
                .andExpect(jsonPath("$.mobileMatch").value(true));
    }

    @Test
    void webhook_recordsAMobileMismatchAsASoftSignalWithoutBlockingTheBadge() throws Exception {
        User u = user("9830000004");
        String ref = start(u);

        deliver(successBody(ref, "9999999999", "hash-" + UUID.randomUUID()));

        IdentityVerification row = verifications.findByRef(ref).orElseThrow();
        assertThat(row.getMobileMatch()).isFalse();
        assertThat(row.isBadge()).isTrue();
    }

    @Test
    void webhook_rejectsAForgedSignature_butStillAnswers200() throws Exception {
        User u = user("9830000005");
        String ref = start(u);
        String body = successBody(ref, "9830000005", "hash-" + UUID.randomUUID());

        mvc.perform(post(Routes.Webhooks.CASHFREE_DIGILOCKER)
                        .header("x-webhook-timestamp", "1700000000")
                        .header("x-webhook-signature", "bm90LWEtc2lnbmF0dXJl")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());
        // Unsigned at all.
        mvc.perform(post(Routes.Webhooks.CASHFREE_DIGILOCKER)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());

        assertThat(verifications.findByRef(ref).orElseThrow().isBadge()).isFalse();
    }

    @Test
    void webhook_isIdempotentOnReplay() throws Exception {
        User u = user("9830000006");
        String ref = start(u);
        String body = successBody(ref, "9830000006", "hash-" + UUID.randomUUID());

        deliver(body);
        var firstStamp = verifications.findByRef(ref).orElseThrow().getVerifiedAt();
        deliver(body);

        IdentityVerification row = verifications.findByRef(ref).orElseThrow();
        assertThat(row.isBadge()).isTrue();
        assertThat(row.getVerifiedAt()).isEqualTo(firstStamp);
    }

    @Test
    void webhook_swallowsAnUnknownRefAndMalformedJson_alwaysAnswering200() throws Exception {
        deliver("{\"type\":\"X\",\"ref\":\"no-such-ref\",\"status\":\"SUCCESS\",\"data\":null}");
        deliver("not json at all");
    }

    @Test
    void webhook_onFailure_marksFailedAndGrantsNoBadge() throws Exception {
        User u = user("9830000007");
        String ref = start(u);

        deliver("{\"type\":\"DIGILOCKER_VERIFICATION_FAILED\",\"ref\":\"" + ref
                + "\",\"status\":\"FAILED\",\"data\":null}");

        IdentityVerification row = verifications.findByRef(ref).orElseThrow();
        assertThat(row.isBadge()).isFalse();
        assertThat(row.getStatus()).isEqualTo(VerificationStatuses.FAILED);
        // A plain failure carries no masked value, so it is retryable rather than a 409.
        assertThat(row.getMaskedAadhaar()).isNull();
        mvc.perform(post(Routes.Verification.AADHAAR).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isAccepted());
    }

    @Test
    void webhook_rejectsAStaleTimestamp_soACapturedPayloadIsNotReplayableForever() throws Exception {
        User u = user("9830000010");
        String ref = start(u);
        String body = successBody(ref, "9830000010", "hash-" + UUID.randomUUID());
        String stale = String.valueOf(System.currentTimeMillis() - Duration.ofHours(1).toMillis());

        mvc.perform(post(Routes.Webhooks.CASHFREE_DIGILOCKER)
                        .header("x-webhook-timestamp", stale)
                        .header("x-webhook-signature", webhookSignature.sign(stale, body))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());

        assertThat(verifications.findByRef(ref).orElseThrow().isBadge()).isFalse();
    }

    @Test
    void aBlankSigningKeyIsRefusedRatherThanSilentlyAcceptingEverySignature() {
        assertThatThrownBy(() -> new WebhookSignature("  "))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new WebhookSignature(null))
                .isInstanceOf(IllegalStateException.class);
    }

    // ---------------- one Aadhaar = one account (ADR-009b) ----------------

    @Test
    void aSecondAccountCannotClaimTheSameIdentity_andLearnsSoAs409() throws Exception {
        String sharedHash = "hash-shared-" + UUID.randomUUID();
        User first = user("9830000008");
        User second = user("9830000009");

        deliver(successBody(start(first), "9830000008", sharedHash));
        String secondRef = start(second);
        deliver(successBody(secondRef, "9830000009", sharedHash));

        IdentityVerification collided = verifications.findByRef(secondRef).orElseThrow();
        assertThat(collided.isBadge()).isFalse();
        assertThat(collided.getStatus()).isEqualTo(VerificationStatuses.FAILED);
        assertThat(users.findById(second.getId()).orElseThrow().isAadhaarVerified()).isFalse();

        mvc.perform(post(Routes.Verification.AADHAAR)
                        .header(HttpHeaders.AUTHORIZATION, bearer(second)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("aadhaar_already_registered"));
    }
}
