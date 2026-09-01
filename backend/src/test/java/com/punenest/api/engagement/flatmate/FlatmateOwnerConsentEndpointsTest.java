package com.punenest.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * {@code POST /flatmates/owner-consent} — consent taken before the group it will be read onto.
 *
 * <p>The group-scoped twin already existed and worked, but nothing could reach it at the moment the
 * form asks the question: the tenant is filling in the group that does not exist yet. So
 * {@code OwnerConsentModal} ran an OTP round-trip against a simulated dispatch and wrote the result
 * to localStorage, and the create payload's {@code ownerConsent: true} was dropped at the door —
 * {@code ownerConsent} is deliberately not client-settable. The tenant phoned their landlord, read
 * out a code, and the server learnt nothing. No chip, and an Ops review entry stating consent was
 * absent.
 *
 * <p>V27 already described the fix: {@code flatmate_owner_consents} is unique on
 * {@code (owner_mobile, granted_by)} with a <em>nullable</em> {@code group_id}. Consent is a fact
 * about two people, not about one post — so it can be granted first and read back at submit time.
 * The last two tests below are the ones that matter: consent granted before creation lands the flag,
 * and asking for the flag without having earned it does not.
 */
@DisplayName("Flatmates — owner consent, granted before the group exists")
class FlatmateOwnerConsentEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @PersistenceContext
    EntityManager em;

    /** Audit writes run {@code REQUIRES_NEW} and escape this test's rollback. */
    private final List<String> createdActors = new ArrayList<>();
    private final List<String> usedMobiles = new ArrayList<>();

    @AfterEach
    void removeRowsThatEscapedRollback() {
        createdActors.forEach(actor -> {
            jdbc.update("delete from audit_log where actor = ?", actor);
            jdbc.update("delete from flatmate_owner_consents where granted_by = ?::uuid", actor);
        });
        usedMobiles.forEach(m -> jdbc.update("delete from otp_codes where mobile = ?", m));
        createdActors.clear();
        usedMobiles.clear();
    }

    private User user(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    /**
     * Sends the code, then rewrites the stored hash to one this test knows. The real code is only
     * ever logged, so a test cannot read it back; forcing the hash is how the rest of the suite
     * completes an OTP. {@code em.clear()} is not optional — Hibernate would otherwise resolve the
     * row to the instance it already holds and verify against the stale hash.
     */
    private void sendAndForceCode(User tenant, String ownerMobile) throws Exception {
        usedMobiles.add(ownerMobile);
        mvc.perform(post(Routes.Flatmates.OWNER_CONSENT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ownerMobile\":\"%s\"}".formatted(ownerMobile)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.consentRecorded").value(false));
        em.flush();
        jdbc.update("""
                UPDATE otp_codes SET code_hash = ?
                WHERE id = (SELECT id FROM otp_codes WHERE mobile = ?
                            ORDER BY created_at DESC LIMIT 1)""",
                sha256Hex("424242"), ownerMobile);
        em.clear();
    }

    private void record(User tenant, String ownerMobile) throws Exception {
        mvc.perform(post(Routes.Flatmates.OWNER_CONSENT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ownerMobile\":\"%s\",\"otp\":\"424242\"}".formatted(ownerMobile)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.consentRecorded").value(true));
    }

    private static String sha256Hex(String raw) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("the first call sends a code, the second writes a consent with no group")
    void twoStepFlowWritesAGrouplessRow() throws Exception {
        User tenant = user("9830000401", "Tenant");
        sendAndForceCode(tenant, "9830000402");

        // The code is scoped to its own purpose: it can never be presented at /auth/login.
        String purpose = jdbc.queryForObject(
                "select purpose from otp_codes where mobile = '9830000402'", String.class);
        assertThat(purpose).isEqualTo("owner-consent");

        record(tenant, "9830000402");

        Integer grouplessRows = jdbc.queryForObject("""
                select count(*) from flatmate_owner_consents
                 where owner_mobile = '9830000402' and granted_by = ?::uuid and group_id is null""",
                Integer.class, tenant.getId().toString());
        assertThat(grouplessRows).isEqualTo(1);
    }

    @Test
    @DisplayName("consent granted before the group is created lands on the group")
    void consentIsReadBackAtCreateTime() throws Exception {
        User tenant = user("9830000403", "Tenant");
        sendAndForceCode(tenant, "9830000404");
        record(tenant, "9830000404");

        // This is the whole point. The modal asks for consent while the form is still open, so the
        // group cannot be named yet; the row keyed on (owner, tenant) is what carries it across.
        mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Replacement flatmate","locality":"Baner","rent":40000,
                                 "name":"Tenant","role":"tenant","consentMobile":"9830000404"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ownerConsent").value(true));
    }

    @Test
    @DisplayName("claiming consent without having taken it does not grant it")
    void theFlagIsNotClientSettable() throws Exception {
        User tenant = user("9830000405", "Optimist");

        mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Replacement flatmate","locality":"Baner","rent":40000,
                                 "name":"Optimist","role":"tenant","consentMobile":"9830000406",
                                 "ownerConsent":true}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ownerConsent").value(false));
    }

    @Test
    @DisplayName("a wrong code records nothing")
    void wrongCodeIsRefused() throws Exception {
        User tenant = user("9830000407", "Tenant");
        sendAndForceCode(tenant, "9830000408");

        mvc.perform(post(Routes.Flatmates.OWNER_CONSENT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ownerMobile\":\"9830000408\",\"otp\":\"000000\"}"))
                .andExpect(status().isUnauthorized());

        Integer rows = jdbc.queryForObject(
                "select count(*) from flatmate_owner_consents where owner_mobile = '9830000408'",
                Integer.class);
        assertThat(rows).isZero();
    }

    @Test
    @DisplayName("a tenant cannot consent on their own behalf")
    void selfConsentIsRefused() throws Exception {
        User tenant = user("9830000409", "SelfServer");

        // Self-consent would make the record worthless, and it is the one shortcut somebody would
        // certainly try — the number is the tenant's own, and they hold the phone.
        mvc.perform(post(Routes.Flatmates.OWNER_CONSENT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ownerMobile\":\"9830000409\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("consent cannot be requested anonymously")
    void anonymousIsRefused() throws Exception {
        mvc.perform(post(Routes.Flatmates.OWNER_CONSENT)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ownerMobile\":\"9830000410\"}"))
                .andExpect(status().isUnauthorized());
    }
}
