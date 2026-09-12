package com.draazy.api.identity.user.erasure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The DPDP erasure boundary (tech debt D177): what must go, and what must <em>stay</em>.
 *
 * <p>Both halves are load-bearing and the second is the one nobody writes a test for. An erasure
 * that took the rent agreement with it would be a compliance failure in the opposite direction —
 * DPDP s.8(7) permits, and other statutes require, retention — and it would be undetectable
 * afterwards, because the evidence it destroyed is the evidence you would need to notice. So every
 * retained category asserted here is asserted as a positive: the row is still there, and still
 * points at the same id.
 *
 * <p>See {@code ErasureRetention} for which statute stands behind each retention.
 */
@DisplayName("DPDP erasure — erased, pseudonymised, and deliberately retained")
class ErasureBoundaryTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    ErasureRequestRepository requests;
    @Autowired
    EntityManager entityManager;

    /** Audit rows commit past this test's rollback ({@code REQUIRES_NEW}); clean them explicitly. */
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setEmail(name.toLowerCase() + "@example.com");
        u.setCity("Pune");
        u.setAvatar("https://cdn.example/" + mobile + ".jpg");
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "2BHK in Kothrud", "rent", "apartment", 24000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("880"));
        p.setStatus(PropertyStatus.APPROVED);
        return properties.saveAndFlush(p);
    }

    private String fileRequest(User subject) throws Exception {
        String body = mvc.perform(post("/me/erasure")
                        .header(HttpHeaders.AUTHORIZATION, bearer(subject))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"I have moved out of Pune\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("pending"))
                .andReturn().getResponse().getContentAsString();
        return body.replaceAll("^.*\"id\":\"([^\"]+)\".*$", "$1");
    }

    // ------------------------------------------------------------------ authorisation

    /**
     * Deciding an erasure is destructive, irreversible, and one rung above every other moderation
     * power here — staff may take a listing down and suspend an account, and both are reversible.
     */
    @Test
    @DisplayName("staff cannot decide an erasure request; only an admin can")
    void staffCannotDecide() throws Exception {
        User subject = user("9800000301", "owner", "Subject");
        User staff = user("9800000302", "staff", "Ops");
        String id = fileRequest(subject);

        mvc.perform(patch("/admin/erasure-requests/{id}", id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"execute\"}"))
                .andExpect(status().isForbidden());

        // The refusal has to happen before anything runs, not on the way out of a method that did.
        assertThat(users.findById(subject.getId()).orElseThrow().getName()).isEqualTo("Subject");
        assertThat(requests.findById(UUID.fromString(id)).orElseThrow().getStatus())
                .isEqualTo(ErasureStatuses.PENDING);
    }

    /** A statutory right is not a favour: the subject files it themselves, with no privilege. */
    @Test
    @DisplayName("a second live request is refused rather than queued twice")
    void oneLiveRequestPerSubject() throws Exception {
        User subject = user("9800000303", "buyer", "Subject");
        fileRequest(subject);

        mvc.perform(post("/me/erasure")
                        .header(HttpHeaders.AUTHORIZATION, bearer(subject))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isConflict());
    }

    // ------------------------------------------------------------------ the boundary

    @Test
    @DisplayName("execution erases identity, retains the contract record, and leaves an anonymous audit")
    void executionErasesIdentityAndRetainsObligations() throws Exception {
        User subject = user("9800000304", "owner", "Erasable");
        User admin = user("9800000305", "admin", "Admin");
        Property listing = listing(subject);
        UUID subjectId = subject.getId();
        String originalMobile = subject.getMobile();

        // Data that must go: an auth credential, a masked government number, and the free text the
        // subject wrote about themselves. The profile columns are the old V13's, not the old V6's -- V13 reshaped
        // this table, and a sweep written from the original migration names four columns that no
        // longer exist.
        jdbc.update("insert into otp_codes (mobile, code_hash, expires_at) values (?, ?, now() + interval '5 min')",
                originalMobile, "hashed");
        jdbc.update("insert into owner_kyc (user_id, pan_masked, aadhaar_masked) values (?, ?, ?)",
                subjectId, "ABCDE****F", "XXXX XXXX 1234");
        jdbc.update("""
                insert into tenant_profiles (user_id, name, occupation, income, prior_landlord, about, score)
                values (?, ?, ?, ?, ?, ?, ?)
                """, subjectId, "Erasable", "Architect", 180000L, "Mr Deshpande, 98xxxxxx01",
                "Quiet, non-smoker, works from home", 72);

        // Data that must stay: evidence of a contract with somebody else. The counterparty's proof
        // of the tenancy is not the erasing party's to destroy (Limitation Act 1963 art.113).
        UUID agreementId = UUID.randomUUID();
        jdbc.update("""
                insert into rent_agreements (id, property_id, owner_id, tenant_mobile, rent, status)
                values (?, ?, ?, ?, ?, 'registered')
                """, agreementId, listing.getId(), subjectId, "9800000399", 24000L);

        String id = fileRequest(subject);

        mvc.perform(patch("/admin/erasure-requests/{id}", id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"execute\",\"note\":\"no live obligations\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("completed"))
                // The audit document is published so the subject can see what was kept and why.
                .andExpect(jsonPath("$.retained").value(
                        org.hamcrest.Matchers.containsString("rent_agreements")));

        entityManager.flush();

        // --- erased -----------------------------------------------------------------------
        User after = users.findById(subjectId).orElseThrow();
        assertThat(after.getName()).isNull();
        assertThat(after.getEmail()).isNull();
        assertThat(after.getCity()).isNull();
        assertThat(after.getAvatar()).isNull();
        assertThat(after.getPasswordHash()).isNull();
        assertThat(after.isMobileVerified()).isFalse();
        assertThat(after.isArchived()).isTrue();
        // Pseudonymised, not blanked: the column is NOT NULL UNIQUE with a format CHECK, and all
        // three still hold. The value must not be the old number and must not be derivable from it.
        assertThat(after.getMobile()).isNotEqualTo(originalMobile).matches("^[6-9][0-9]{9}$");

        assertThat(jdbc.queryForObject("select count(*) from otp_codes where mobile = ?",
                Integer.class, originalMobile)).isZero();
        assertThat(jdbc.queryForObject("select pan_masked from owner_kyc where user_id = ?",
                String.class, subjectId)).isNull();
        assertThat(jdbc.queryForObject("select aadhaar_masked from owner_kyc where user_id = ?",
                String.class, subjectId)).isNull();
        assertThat(jdbc.queryForMap("select * from tenant_profiles where user_id = ?", subjectId))
                .containsEntry("name", null)
                .containsEntry("occupation", null)
                .containsEntry("prior_landlord", null)
                .containsEntry("about", null)
                .containsEntry("income", null)
                // Not personal, and not erased: a derived screening signal on an id that no longer
                // resolves to anybody.
                .containsEntry("score", 72);

        // --- deliberately retained --------------------------------------------------------
        assertThat(jdbc.queryForObject("select owner_id from rent_agreements where id = ?",
                UUID.class, agreementId)).isEqualTo(subjectId);
        // The listing survives too: it carries no contact data of its own, and enquiries, visits and
        // deals reference it. It de-identifies with the users row rather than by being deleted.
        assertThat(properties.findById(listing.getId())).isPresent();

        // --- the record of the erasure ----------------------------------------------------
        ErasureRequest completed = requests.findById(UUID.fromString(id)).orElseThrow();
        assertThat(completed.getStatus()).isEqualTo(ErasureStatuses.COMPLETED);
        // The whole design rests on this: a completed request must not still name its subject, or
        // the table becomes a directory of everybody who asked to be forgotten.
        assertThat(completed.getSubjectId()).isNull();
        assertThat(completed.getSubjectDigest()).isNotBlank().doesNotContain(originalMobile);
        assertThat(completed.getDecidedBy()).isEqualTo(admin.getId());
        assertThat(completed.getErased()).contains("otp_codes").contains("owner_kyc");
        assertThat(completed.getRetained()).contains("notYetSwept");
    }

    /**
     * A rejection is a real outcome, not an escape hatch — s.8(7) is the reason it has to exist. It
     * must leave the account intact and say why, because the subject is entitled to know which
     * obligation blocked them and when they can ask again.
     */
    @Test
    @DisplayName("a rejection needs a reason, keeps the account, and keeps the subject reachable")
    void rejectionRequiresAReasonAndChangesNothing() throws Exception {
        User subject = user("9800000306", "owner", "Subject");
        User admin = user("9800000307", "admin", "Admin");
        String id = fileRequest(subject);

        mvc.perform(patch("/admin/erasure-requests/{id}", id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"reject\"}"))
                .andExpect(status().isBadRequest());

        mvc.perform(patch("/admin/erasure-requests/{id}", id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"reject\",\"note\":\"registered agreement runs to March\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("rejected"));

        assertThat(users.findById(subject.getId()).orElseThrow().getName()).isEqualTo("Subject");
        ErasureRequest rejected = requests.findById(UUID.fromString(id)).orElseThrow();
        // Kept, unlike a completed request: nothing was erased, so the subject still exists and
        // still has to be able to find their own refusal.
        assertThat(rejected.getSubjectId()).isEqualTo(subject.getId());
        assertThat(rejected.getDecisionNote()).contains("March");
    }

    /** Terminal is terminal. A decided request is not re-decided; a fresh ask is a fresh request. */
    @Test
    @DisplayName("a decided request cannot be decided again")
    void decidedIsTerminal() throws Exception {
        User subject = user("9800000308", "buyer", "Subject");
        User admin = user("9800000309", "admin", "Admin");
        String id = fileRequest(subject);

        mvc.perform(patch("/admin/erasure-requests/{id}", id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"reject\",\"note\":\"unsettled payout\"}"))
                .andExpect(status().isOk());

        mvc.perform(patch("/admin/erasure-requests/{id}", id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"execute\",\"note\":\"changed my mind\"}"))
                .andExpect(status().isConflict());
    }

    /**
     * The pseudonym must be a function of the id and of nothing else. If it drew on the mobile it
     * replaces it would be a reversible pointer to the number, and the whole substitution would be
     * theatre.
     */
    @Test
    @DisplayName("the mobile pseudonym is deterministic in the id, stable, and satisfies the column CHECK")
    void pseudonymIsDerivedFromTheIdAlone() {
        UUID a = UUID.fromString("11111111-2222-3333-4444-555555555555");
        UUID b = UUID.fromString("11111111-2222-3333-4444-555555555556");

        assertThat(ErasureService.pseudonymMobile(a))
                .isEqualTo(ErasureService.pseudonymMobile(a))
                .isNotEqualTo(ErasureService.pseudonymMobile(b))
                .matches("^[6-9][0-9]{9}$");
    }
}
