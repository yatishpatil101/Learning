package com.punenest.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The ownership gate (D190/Q15) — the badge the product's strongest trust claim rests on.
 *
 * <p>Before this slice {@code properties.ownership_verified} was written by the demo seed and by
 * nothing else, so <em>every</em> assertion here would have failed for the same uninteresting
 * reason: the routes did not exist. What the tests are actually pinning down is narrower and worth
 * naming.
 *
 * <p><strong>The badge is earned, not asserted</strong> — three independent facts, all required,
 * and a partial set is refused with the missing ones named rather than with a bare 400 that sends
 * the operator to the database.
 *
 * <p><strong>The badge lapses without anyone writing to the row.</strong> That test asserts the
 * stored column is still {@code true} while the wire says {@code false}, which is the only way to
 * tell a derived read apart from a sweep that happens to have run. A sweep implementation would
 * pass every other test in this file.
 *
 * <p><strong>Expiry is the earliest of the documents relied on</strong>, and a never-expiring
 * registry document does not drag the whole set to "never". Both of the expiry tests use documents
 * with <em>different</em> windows on purpose: with one expiring document in play, earliest and
 * latest are the same date and the assertion proves nothing.
 *
 * <p><strong>Holding the staff role is not the whole check.</strong> Roles are additive here — an
 * ops user is also somebody's landlord — so there is a test for the staff member who tries to
 * badge their own flat, which the {@code @PreAuthorize} on its own would wave through.
 */
@DisplayName("Ownership gate — earned on evidence, and lapsing with it")
class OwnershipVerificationTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    /** Audit rows are written {@code REQUIRES_NEW} and therefore survive this test's rollback. */
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("User " + mobile);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "2BHK in Baner", "rent", "apartment", 34000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        p.setStatus(PropertyStatus.APPROVED);
        return properties.saveAndFlush(p);
    }

    private String ownership(Property p) {
        return "/properties/" + p.getId() + "/verification/ownership";
    }

    /**
     * An identity document has to say whose it is (D202), so the fixture supplies a name for exactly
     * the two doc types that require one. Spelled out here rather than asked of
     * {@code OwnershipEvidenceTypes} on purpose: a fixture that derives the rule from the code under
     * test agrees with it however wrong it is.
     */
    private String evidenceBody(String docType, Instant issuedAt) {
        return evidenceBody(docType, issuedAt,
                "aadhaar".equals(docType) || "pan".equals(docType) ? "Ramesh Kulkarni" : null);
    }

    private String evidenceBody(String docType, Instant issuedAt, String subjectName) {
        return "{\"docType\":\"" + docType + "\",\"issuedAt\":\"" + issuedAt + "\""
                + (subjectName == null ? "" : ",\"subjectName\":\"" + subjectName + "\"")
                + "}";
    }

    private void record(Property p, String staffToken, String docType, Instant issuedAt) throws Exception {
        mvc.perform(post(ownership(p) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(evidenceBody(docType, issuedAt)))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("a complete evidence set earns the badge, and the listing starts showing it")
    void aCompleteEvidenceSetEarnsTheBadge() throws Exception {
        Property listing = listing(user("9820000601", Roles.Wire.OWNER));
        String staff = bearer(user("9820000602", Roles.Wire.STAFF));
        Instant recent = Instant.now().minus(5, ChronoUnit.DAYS);

        mvc.perform(get("/properties/" + listing.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownershipVerified").value(false));

        record(listing, staff, "index_ii", recent);
        record(listing, staff, "aadhaar", recent);
        record(listing, staff, "site_photos", recent);

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true))
                .andExpect(jsonPath("$.missingKinds").isEmpty())
                .andExpect(jsonPath("$.evidence.length()").value(3));

        mvc.perform(get("/properties/" + listing.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownershipVerified").value(true));
    }

    @Test
    @DisplayName("a partial set is refused with the missing facts named, not a bare 400")
    void aPartialSetIsRefusedWithTheMissingFactsNamed() throws Exception {
        Property listing = listing(user("9820000603", Roles.Wire.OWNER));
        String staff = bearer(user("9820000604", Roles.Wire.STAFF));

        record(listing, staff, "index_ii", Instant.now().minus(2, ChronoUnit.DAYS));

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("owner_identity")))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("site_presence")));

        mvc.perform(get("/properties/" + listing.getId()))
                .andExpect(jsonPath("$.ownershipVerified").value(false));
    }

    @Test
    @DisplayName("an expired document does not count — a 2019 tax receipt proves nothing today")
    void anExpiredDocumentDoesNotSatisfyItsFact() throws Exception {
        Property listing = listing(user("9820000605", Roles.Wire.OWNER));
        String staff = bearer(user("9820000606", Roles.Wire.STAFF));
        Instant recent = Instant.now().minus(5, ChronoUnit.DAYS);

        // Ninety-day window, issued a hundred days ago: recorded, and useless.
        record(listing, staff, "tax_receipt", Instant.now().minus(100, ChronoUnit.DAYS));
        record(listing, staff, "aadhaar", recent);
        record(listing, staff, "site_photos", recent);

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("ownership_proof")));

        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence.length()").value(3))
                .andExpect(jsonPath("$.missingKinds[0]").value("ownership_proof"));
    }

    @Test
    @DisplayName("the badge expires with the earliest document it rests on, not the latest")
    void expiryIsTheEarliestOfTheDocumentsReliedOn() throws Exception {
        Property listing = listing(user("9820000607", Roles.Wire.OWNER));
        String staff = bearer(user("9820000608", Roles.Wire.STAFF));
        Instant tenDaysAgo = Instant.now().minus(10, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);

        // Two expiring documents with different windows, plus one that never expires. The tax
        // receipt runs out first (90 days) and the photographs last (180), so a gate that took the
        // latest — or that ignored the never-expiring document rather than skipping it — would put
        // a different, later date on the wire.
        record(listing, staff, "tax_receipt", tenDaysAgo);
        record(listing, staff, "aadhaar", Instant.now().minus(400, ChronoUnit.DAYS));
        record(listing, staff, "site_photos", tenDaysAgo);

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true))
                .andExpect(jsonPath("$.verifiedUntil")
                        .value(tenDaysAgo.plus(90, ChronoUnit.DAYS).toString()));
    }

    @Test
    @DisplayName("within one fact the newest document wins — a fresh bill extends the badge")
    void afresherDocumentOfTheSameKindSupersedesTheOlderOne() throws Exception {
        Property listing = listing(user("9820000615", Roles.Wire.OWNER));
        String staff = bearer(user("9820000616", Roles.Wire.STAFF));
        Instant nearlyStale = Instant.now().minus(80, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
        Instant fresh = Instant.now().minus(5, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);

        // Both bills are current; the older one has ten days left. If the gate took the earliest
        // within a fact rather than the strongest, sending a fresh bill would not extend anything.
        record(listing, staff, "electricity_bill", nearlyStale);
        record(listing, staff, "electricity_bill", fresh);
        record(listing, staff, "pan", Instant.now().minus(400, ChronoUnit.DAYS));
        record(listing, staff, "site_photos", fresh);

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verifiedUntil")
                        .value(fresh.plus(90, ChronoUnit.DAYS).toString()));
    }

    @Test
    @DisplayName("a lapsed badge stops showing with no write to the row — derived, not swept")
    void aLapsedBadgeStopsShowingWithNoWriteToTheRow() throws Exception {
        Property listing = listing(user("9820000609", Roles.Wire.OWNER));
        listing.verifyOwnership(Instant.now().minus(200, ChronoUnit.DAYS),
                Instant.now().minus(1, ChronoUnit.DAYS));
        properties.saveAndFlush(listing);

        // The stored verdict is untouched and still true...
        assertThat(jdbc.queryForObject(
                "select ownership_verified from properties where id = ?", Boolean.class, listing.getId()))
                .isTrue();

        // ...and the buyer is nonetheless told the truth. A sweep would need to have run first.
        mvc.perform(get("/properties/" + listing.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownershipVerified").value(false));
    }

    @Test
    @DisplayName("a stranger gets 404 — a 403 would confirm the listing exists")
    void aStrangerCannotSeeThatTheCaseExists() throws Exception {
        Property listing = listing(user("9820000610", Roles.Wire.OWNER));
        String stranger = bearer(user("9820000611", Roles.Wire.BUYER));
        String owner = bearer(users.findById(listing.getOwner().getId()).orElseThrow());

        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, stranger))
                .andExpect(status().isNotFound());

        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.missingKinds.length()").value(3));
    }

    @Test
    @DisplayName("an owner cannot record evidence for their own listing")
    void anOwnerCannotRecordTheirOwnEvidence() throws Exception {
        Property listing = listing(user("9820000612", Roles.Wire.OWNER));
        String owner = bearer(users.findById(listing.getOwner().getId()).orElseThrow());

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, owner)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(evidenceBody("index_ii", Instant.now().minus(1, ChronoUnit.DAYS))))
                .andExpect(status().isForbidden());

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a document dated in the future is refused")
    void aFutureDatedDocumentIsRefused() throws Exception {
        Property listing = listing(user("9820000613", Roles.Wire.OWNER));
        String staff = bearer(user("9820000614", Roles.Wire.STAFF));

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(evidenceBody("index_ii", Instant.now().plus(2, ChronoUnit.DAYS))))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("a staff member cannot verify their own listing — the role is not the whole check")
    void staffCannotVerifyTheirOwnListing() throws Exception {
        // Roles are additive: this person works the ops desk and also lets out a flat. The
        // @PreAuthorize lets them through, and the maker/checker rule has to stop them.
        User staffWhoIsAlsoALandlord = user("9820000617", Roles.Wire.STAFF);
        Property ownListing = listing(staffWhoIsAlsoALandlord);
        String token = bearer(staffWhoIsAlsoALandlord);

        mvc.perform(post(ownership(ownListing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(evidenceBody("index_ii", Instant.now().minus(1, ChronoUnit.DAYS))))
                .andExpect(status().isForbidden());

        mvc.perform(post(ownership(ownListing)).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isForbidden());

        // A well-formed withdrawal, so that what refuses it is the maker/checker rule and not a
        // missing parameter — `reason` is required, and its absence would 400 before the guard runs.
        mvc.perform(delete(ownership(ownListing))
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .param("reason", "changed my mind"))
                .andExpect(status().isForbidden());

        // Somebody else's listing is still their job.
        Property otherListing = listing(user("9820000618", Roles.Wire.OWNER));
        record(otherListing, token, "index_ii", Instant.now().minus(1, ChronoUnit.DAYS));
    }

    @Test
    @DisplayName("a badge granted in error can be withdrawn, and the evidence survives the withdrawal")
    void staffCanWithdrawABadgeAndTheCaseFileRemains() throws Exception {
        Property listing = listing(user("9820000619", Roles.Wire.OWNER));
        String staff = bearer(user("9820000620", Roles.Wire.STAFF));
        Instant recent = Instant.now().minus(5, ChronoUnit.DAYS);

        record(listing, staff, "index_ii", recent);
        record(listing, staff, "aadhaar", recent);
        record(listing, staff, "site_photos", recent);
        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true));

        // The deed turns out to be for the flat next door.
        mvc.perform(delete(ownership(listing))
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .param("reason", "index II is for a different flat"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(false))
                .andExpect(jsonPath("$.verifiedAt").doesNotExist())
                .andExpect(jsonPath("$.verifiedUntil").doesNotExist())
                // The record of what was accepted is what an investigation reads. It stays.
                .andExpect(jsonPath("$.evidence.length()").value(3));

        mvc.perform(get("/properties/" + listing.getId()))
                .andExpect(jsonPath("$.ownershipVerified").value(false));

        // The raw read needs an explicit flush, and the reason is worth stating: `jdbc` and the
        // persistence context share this test's transaction but not its dirty state, so without
        // this line the assertion reports whatever JPA last happened to write rather than what the
        // withdrawal did. It passed before D202 because nothing between the grant and here forced a
        // flush at all, so the column still held its `false` from insert — the right answer for the
        // wrong reason. Adding the verification row lock introduced a query on `Property` in the
        // withdrawal path, which auto-flushed the grant, and the accident became visible.
        properties.flush();
        assertThat(jdbc.queryForObject(
                "select ownership_verified from properties where id = ?", Boolean.class, listing.getId()))
                .isFalse();
    }

    @Test
    @DisplayName("withdrawing a badge requires a stated reason")
    void aWithdrawalMustSayWhy() throws Exception {
        Property listing = listing(user("9820000621", Roles.Wire.OWNER));
        String staff = bearer(user("9820000622", Roles.Wire.STAFF));

        mvc.perform(delete(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isBadRequest());

        mvc.perform(delete(ownership(listing))
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .param("reason", "   "))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("the owner is told which fact is missing, not which government ID was collected")
    void theOwnersViewOfTheCaseFileWithholdsTheDocumentType() throws Exception {
        Property listing = listing(user("9820000623", Roles.Wire.OWNER));
        String staff = bearer(user("9820000624", Roles.Wire.STAFF));
        String owner = bearer(users.findById(listing.getOwner().getId()).orElseThrow());

        record(listing, staff, "aadhaar", Instant.now().minus(3, ChronoUnit.DAYS));

        // Ops see the whole file — it is their case.
        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence[0].docType").value("aadhaar"));

        // The owner sees enough to act on and nothing more. On an agent-posted listing this account
        // is not necessarily the person whose Aadhaar was sighted, and which ID somebody holds is
        // personal data in its own right.
        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence[0].kind").value("owner_identity"))
                .andExpect(jsonPath("$.evidence[0].current").value(true))
                .andExpect(jsonPath("$.evidence[0].docType").doesNotExist())
                .andExpect(jsonPath("$.evidence[0].documentId").doesNotExist())
                .andExpect(jsonPath("$.evidence[0].subjectName").doesNotExist())
                .andExpect(jsonPath("$.missingKinds.length()").value(2));
    }

    /**
     * D202. An {@code owner_identity} row that records <em>that</em> a government ID was sighted,
     * without recording <em>whose</em>, is not evidence: there is nothing for a later dispute to
     * check it against, so it cannot be shown to be wrong, so it establishes nothing. The badge's
     * middle claim — that the person listing the flat is the person who owns it — rested entirely on
     * such rows.
     */
    @Test
    @DisplayName("an identity document must say whose it is; the rest need not")
    void anIdentityDocumentMustNameItsSubject() throws Exception {
        Property listing = listing(user("9820000625", Roles.Wire.OWNER));
        String staff = bearer(user("9820000626", Roles.Wire.STAFF));
        Instant recent = Instant.now().minus(3, ChronoUnit.DAYS);

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(evidenceBody("aadhaar", recent, null)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString("subjectName")));

        // Blank is the same refusal as absent — a space is not a name.
        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(evidenceBody("pan", recent, "   ")))
                .andExpect(status().isBadRequest());

        // Nothing was recorded by either attempt.
        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(jsonPath("$.evidence.length()").value(0));

        // A title deed names a person too, but which person is a question the deed itself answers,
        // so the name is optional there and its absence must not block the desk. Dated a day
        // earlier, so the case file's newest-first order is decided rather than incidental.
        record(listing, staff, "index_ii", recent.minus(1, ChronoUnit.DAYS));

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(evidenceBody("aadhaar", recent, "  Sunita Deshpande ")))
                .andExpect(status().isCreated());

        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence.length()").value(2))
                .andExpect(jsonPath("$.evidence[0].docType").value("aadhaar"))
                .andExpect(jsonPath("$.evidence[0].subjectName").value("Sunita Deshpande"))
                .andExpect(jsonPath("$.evidence[1].docType").value("index_ii"))
                .andExpect(jsonPath("$.evidence[1].subjectName").doesNotExist());
    }
}
