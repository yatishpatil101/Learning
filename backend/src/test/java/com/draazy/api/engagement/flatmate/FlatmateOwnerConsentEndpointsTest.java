package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
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

// Consent is a fact about two people, not about one post, so it is granted before the group exists
// and read back at submit time. ownerConsent is never client-settable.
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

    // The real code is only ever logged, so the stored hash is forced to one this test knows;
    // em.clear() is required or Hibernate verifies against the instance it already holds.
    private void sendAndForceCode(User tenant, String ownerMobile) throws Exception {
        sendAndForceCode(tenant, ownerMobile, "Replacement flatmate", "Baner");
        }

        private void sendAndForceCode(User tenant, String ownerMobile, String title, String locality)
            throws Exception {
        usedMobiles.add(ownerMobile);
        mvc.perform(post(Routes.Flatmates.OWNER_CONSENT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                            {"ownerMobile":"%s","title":"%s",
                             "locality":"%s"}
                            """.formatted(ownerMobile, title, locality)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.consentRecorded").value(false))
                // Owner consent spends the same send budget as login, so the resend gap is the
                // server's to state, not the client's to assume.
                .andExpect(jsonPath("$.resendAfterSeconds").exists());
        em.flush();
        jdbc.update("""
                UPDATE otp_codes SET code_hash = ?
                WHERE id = (SELECT id FROM otp_codes WHERE mobile = ?
                            ORDER BY created_at DESC LIMIT 1)""",
                sha256Hex("424242"), ownerMobile);
        em.clear();
    }

    // The verify step names the flat the consent is about (V30): a row stored without an address
    // would vouch for every post the tenant later makes.
    private void record(User tenant, String ownerMobile, String title, String locality)
            throws Exception {
        mvc.perform(post(Routes.Flatmates.OWNER_CONSENT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"ownerMobile":"%s","otp":"424242",
                                 "title":"%s","locality":"%s"}
                                """.formatted(ownerMobile, title, locality)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.consentRecorded").value(true))
                // Nothing left to resend once consent is stored, so the field is omitted.
                .andExpect(jsonPath("$.resendAfterSeconds").doesNotExist());
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
        assertThat(purpose).startsWith("owner-consent:");

        record(tenant, "9830000402", "Replacement flatmate", "Baner");

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
        record(tenant, "9830000404", "Replacement flatmate", "Baner");

        // The modal asks while the form is open, so the group cannot be named yet: the title and
        // locality below must be the pair the consent row was keyed under.
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
                        .content("""
                                {"ownerMobile":"9830000408","otp":"000000",
                                 "title":"Replacement flatmate","locality":"Baner"}
                                """))
                .andExpect(status().isUnauthorized());

        Integer rows = jdbc.queryForObject(
                "select count(*) from flatmate_owner_consents where owner_mobile = '9830000408'",
                Integer.class);
        assertThat(rows).isZero();
    }

    @Test
    @DisplayName("a code presented without naming a flat records nothing")
    void consentMustNameTheFlat() throws Exception {
        User tenant = user("9830000411", "Tenant");
        sendAndForceCode(tenant, "9830000412");

        // A row with no address vouches for every post the tenant ever makes. The correct code is
        // deliberately used: it is the address that is missing.
        mvc.perform(post(Routes.Flatmates.OWNER_CONSENT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ownerMobile\":\"9830000412\",\"otp\":\"424242\"}"))
                .andExpect(status().isBadRequest());

        Integer rows = jdbc.queryForObject(
                "select count(*) from flatmate_owner_consents where owner_mobile = '9830000412'",
                Integer.class);
        assertThat(rows).isZero();
    }

    @Test
    @DisplayName("a send that names no flat costs the owner no SMS")
    void sendMustNameTheFlatToo() throws Exception {
        User tenant = user("9830000415", "Tenant");

        // The refusal the verify step makes, made one step earlier: otherwise the owner has been
        // texted and the tenant has bought a cooldown for a consent that could never be stored.
        mvc.perform(post(Routes.Flatmates.OWNER_CONSENT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ownerMobile\":\"9830000416\"}"))
                .andExpect(status().isBadRequest());

        Integer codes = jdbc.queryForObject(
                "select count(*) from otp_codes where mobile = '9830000416'", Integer.class);
        assertThat(codes).isZero();
    }

    @Test
    @DisplayName("consent granted after the group exists still reaches it")
    void consentTakenLaterReachesThePostItNames() throws Exception {
        User tenant = user("9830000413", "Latecomer");

        // The commoner sequence: post first, then ring the owner. Without re-reading the consent
        // table for an existing post the flag stays false and Ops cannot approve it.
        mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Late consent","locality":"Baner","rent":40000,
                                 "name":"Latecomer","role":"tenant","consentMobile":"9830000414"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ownerConsent").value(false));

        sendAndForceCode(tenant, "9830000414", "Late consent", "Baner");
        record(tenant, "9830000414", "Late consent", "Baner");

        // Scoped to the address the consent was taken under, so it lands on that post and no other.
        Integer consented = jdbc.queryForObject("""
                select count(*) from flatmate_groups
                 where host_id = ?::uuid and owner_consent = true""",
                Integer.class, tenant.getId().toString());
        assertThat(consented).isEqualTo(1);
    }

    @Test
    @DisplayName("a tenant cannot consent on their own behalf")
    void selfConsentIsRefused() throws Exception {
        User tenant = user("9830000409", "SelfServer");

        // Self-consent would make the record worthless, and it is the shortcut somebody would try.
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
