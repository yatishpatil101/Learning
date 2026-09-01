package com.draazy.api.identity.verification;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.cashfree.WebhookSignature;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.StandardEnvironment;
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
        assertThatThrownBy(() -> new WebhookSignature("  ", false, profiles("dev")))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new WebhookSignature(null, false, profiles("dev")))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void theCommittedDefaultSecretIsRefusedOnceTheLiveGatewayIsSwitchedOn() {
        // Harmless under `dev` with the gateway off -- that is the whole point of a demoable default
        // -- but a developer pointing at the Cashfree sandbox is receiving callbacks from outside
        // their machine, so the flag refuses the published key even there.
        assertThatThrownBy(() -> new WebhookSignature("dev-webhook-secret", true, profiles("dev")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("committed default");
        assertThatCode(() -> new WebhookSignature("dev-webhook-secret", false, profiles("dev")))
                .doesNotThrowAnyException();
    }

    @Test
    void theCommittedDefaultSecretIsRefusedAnywhereButDev_notOnlyInProd() {
        // The guard is an allowlist, not a check for `prod` (D147/D155). A container called
        // staging, preview, or nothing at all -- the ordinary state of a first deploy, before the
        // payment rail is switched on -- would otherwise boot on a secret that is in the repository,
        // and both webhook routes are permitAll. Anyone holding this repo could then sign a
        // DigiLocker "verified" result for their own account and take the Verified badge.
        assertThatThrownBy(() -> new WebhookSignature("dev-webhook-secret", false, profiles("prod")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("committed default");
        assertThatThrownBy(
                () -> new WebhookSignature("dev-webhook-secret", false, profiles("staging")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("committed default");
        assertThatThrownBy(() -> new WebhookSignature("dev-webhook-secret", false, profiles()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("committed default");
    }

    private static StandardEnvironment profiles(String... active) {
        StandardEnvironment environment = new StandardEnvironment();
        environment.setActiveProfiles(active);
        return environment;
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

    // ---------------- dev-only "simulate DigiLocker success" (D122) ----------------

    @Test
    void simulate_grantsTheBadgeInDev_withoutARealWebhook() throws Exception {
        User u = user("9830000020");

        mvc.perform(post(Routes.Verification.AADHAAR_SIMULATE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.badge").value(true))
                .andExpect(jsonPath("$.status").value(VerificationStatuses.VERIFIED))
                .andExpect(jsonPath("$.source").value(VerificationSources.DIGILOCKER))
                .andExpect(jsonPath("$.verifiedAt").exists());

        // The user flags leads.contact reads live are flipped, same as a real callback.
        User granted = users.findById(u.getId()).orElseThrow();
        assertThat(granted.isAadhaarVerified()).isTrue();
        assertThat(granted.isVerified()).isTrue();
    }

    @Test
    void simulate_isIdempotentOnReplay_andSelfScoped() throws Exception {
        User u = user("9830000021");

        mvc.perform(post(Routes.Verification.AADHAAR_SIMULATE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk());
        var firstStamp = verifications.findByUserId(u.getId()).orElseThrow().getVerifiedAt();

        // A second call is a no-op — the badge is not re-granted nor the stamp re-written.
        mvc.perform(post(Routes.Verification.AADHAAR_SIMULATE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(VerificationStatuses.VERIFIED));
        assertThat(verifications.findByUserId(u.getId()).orElseThrow().getVerifiedAt())
                .isEqualTo(firstStamp);

        // Self-scoped: no auth, no grant.
        mvc.perform(post(Routes.Verification.AADHAAR_SIMULATE)).andExpect(status().isUnauthorized());
    }
}
