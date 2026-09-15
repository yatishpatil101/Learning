package com.draazy.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.web.Routes;
import com.draazy.api.documents.vault.Document;
import com.draazy.api.documents.vault.DocumentRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

// Ownership gate: badge earned on evidence, expiry lapses derived (not swept) from the earliest
// document relied on, and staff-who-are-also-landlords must not badge their own flat.
@DisplayName("Ownership gate — earned on evidence, and lapsing with it")
class OwnershipVerificationTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    DocumentRepository documents;
    @Autowired
    jakarta.persistence.EntityManager entities;

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
        // A staff account is keyed in the permission map by its desk, and one with no desk is refused
        // outright. Which desk is immaterial here — the seeded document grants all six the same set.
        if (Roles.Wire.STAFF.equals(role)) u.setTeam(Teams.RENTAL);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner) {
        return listing(owner, "rent");
    }

    private Property listing(User owner, String deal) {
        Property p = new Property(owner, "2BHK in Baner", deal, "apartment", 34000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        p.setStatus(PropertyStatus.APPROVED);
        return properties.saveAndFlush(p);
    }

    private String ownership(Property p) {
        return "/properties/" + p.getId() + "/verification/ownership";
    }

    // Identity documents must name whose they are, so the fixture supplies a name for exactly the
    // two doc types that require one — spelled out here rather than derived from the code under test.
    private String evidenceBody(String docType, Instant issuedAt) {
        return evidenceBody(docType, issuedAt,
                "aadhaar".equals(docType) || "pan".equals(docType) ? "Ramesh Kulkarni" : null);
    }

    private String evidenceBody(String docType, Instant issuedAt, String subjectName) {
        return "{\"docType\":\"" + docType + "\",\"issuedOn\":\"" + istDay(issuedAt) + "\""
                + (subjectName == null ? "" : ",\"subjectName\":\"" + subjectName + "\"")
                + "}";
    }

    // The wire carries the day printed on the document, so fixtures reckon their instants in the
    // zone the server reads them in.
    private static String istDay(Instant at) {
        return at.atZone(PlatformTime.IST).toLocalDate().toString();
    }

    /** Where the server starts a validity window: IST midnight of the day the document names. */
    private static Instant istMidnight(Instant at) {
        return at.atZone(PlatformTime.IST).toLocalDate().atStartOfDay(PlatformTime.IST).toInstant();
    }

    private void record(Property p, String staffToken, String docType, Instant issuedAt) throws Exception {
        mvc.perform(post(ownership(p) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(evidenceBody(docType, issuedAt)))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("a sale earns the badge on title plus address proof, and the listing starts showing it")
    void aCompleteEvidenceSetEarnsTheBadge() throws Exception {
        Property listing = listing(user("9820000601", Roles.Wire.OWNER), "buy");
        String staff = bearer(user("9820000602", Roles.Wire.STAFF));
        Instant recent = Instant.now().minus(5, ChronoUnit.DAYS);

        mvc.perform(get("/properties/" + listing.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownershipVerified").value(false));

        record(listing, staff, "index_ii", recent);
        record(listing, staff, "electricity_bill", recent);

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true))
                .andExpect(jsonPath("$.missingKinds").isEmpty())
                .andExpect(jsonPath("$.evidence.length()").value(2));

        mvc.perform(get("/properties/" + listing.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownershipVerified").value(true));
    }

    @Test
    @DisplayName("a rental earns the badge on one current bill alone")
    void aRentalNeedsOnlyAddressProof() throws Exception {
        Property listing = listing(user("9820000627", Roles.Wire.OWNER));
        String staff = bearer(user("9820000628", Roles.Wire.STAFF));

        record(listing, staff, "electricity_bill", Instant.now().minus(5, ChronoUnit.DAYS));

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true))
                .andExpect(jsonPath("$.missingKinds").isEmpty());
    }

    @Test
    @DisplayName("a partial set is refused with the missing facts named, not a bare 400")
    void aPartialSetIsRefusedWithTheMissingFactsNamed() throws Exception {
        Property listing = listing(user("9820000603", Roles.Wire.OWNER), "buy");
        String staff = bearer(user("9820000604", Roles.Wire.STAFF));

        // A bill proves the address, not the title — and a sale is bought on the title.
        record(listing, staff, "electricity_bill", Instant.now().minus(2, ChronoUnit.DAYS));

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("title_proof")))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("address_proof"))));

        mvc.perform(get("/properties/" + listing.getId()))
                .andExpect(jsonPath("$.ownershipVerified").value(false));
    }

    // Index II is the IGR's own extract and can be read back from the registry; a sale deed is a
    // PDF, so it is stronger in law but not stronger as evidence a reviewer can independently check.
    @Test
    @DisplayName("a sale deed plus a bill does not earn the badge — the sale rule names Index II")
    void aSaleDeedDoesNotStandInForIndexII() throws Exception {
        Property listing = listing(user("9820000633", Roles.Wire.OWNER), "buy");
        String staff = bearer(user("9820000634", Roles.Wire.STAFF));
        Instant recent = Instant.now().minus(3, ChronoUnit.DAYS);

        record(listing, staff, "sale_deed", recent);
        record(listing, staff, "electricity_bill", recent);

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("title_proof")));

        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence.length()").value(2))
                .andExpect(jsonPath("$.missingKinds[0]").value("title_proof"))
                .andExpect(jsonPath("$.evidence[?(@.docType=='sale_deed')].kind")
                        .value(org.hamcrest.Matchers.contains("title_support")));

        mvc.perform(get("/properties/" + listing.getId()))
                .andExpect(jsonPath("$.ownershipVerified").value(false));
    }

    @Test
    @DisplayName("an expired document does not count — a 2019 tax receipt proves nothing today")
    void anExpiredDocumentDoesNotSatisfyItsFact() throws Exception {
        Property listing = listing(user("9820000605", Roles.Wire.OWNER));
        String staff = bearer(user("9820000606", Roles.Wire.STAFF));

        // Ninety-day window, issued a hundred days ago: recorded, and useless.
        record(listing, staff, "tax_receipt", Instant.now().minus(100, ChronoUnit.DAYS));

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("address_proof")));

        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence.length()").value(1))
                .andExpect(jsonPath("$.missingKinds[0]").value("address_proof"));
    }

    @Test
    @DisplayName("the badge expires with the document that lapses first, and supporting evidence has no say")
    void expiryIsTheEarliestOfTheDocumentsReliedOn() throws Exception {
        Property listing = listing(user("9820000607", Roles.Wire.OWNER), "buy");
        String staff = bearer(user("9820000608", Roles.Wire.STAFF));
        Instant tenDaysAgo = Instant.now().minus(10, ChronoUnit.DAYS);

        // The deed never expires and must be skipped rather than drag the set to "never"; the tax
        // receipt sets the date, and photographs are supporting evidence with no say.
        record(listing, staff, "index_ii", Instant.now().minus(400, ChronoUnit.DAYS));
        record(listing, staff, "tax_receipt", tenDaysAgo);
        record(listing, staff, "site_photos", Instant.now().minus(170, ChronoUnit.DAYS));

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true))
                .andExpect(jsonPath("$.verifiedUntil")
                        .value(istMidnight(tenDaysAgo).plus(90, ChronoUnit.DAYS).toString()));
    }

    @Test
    @DisplayName("within one fact the newest document wins — a fresh bill extends the badge")
    void afresherDocumentOfTheSameKindSupersedesTheOlderOne() throws Exception {
        Property listing = listing(user("9820000615", Roles.Wire.OWNER));
        String staff = bearer(user("9820000616", Roles.Wire.STAFF));
        Instant nearlyStale = Instant.now().minus(80, ChronoUnit.DAYS);
        Instant fresh = Instant.now().minus(5, ChronoUnit.DAYS);

        // Both bills are current; the older one has ten days left. If the gate took the earliest
        // within a fact rather than the strongest, sending a fresh bill would not extend anything.
        record(listing, staff, "electricity_bill", nearlyStale);
        record(listing, staff, "electricity_bill", fresh);

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verifiedUntil")
                        .value(istMidnight(fresh).plus(90, ChronoUnit.DAYS).toString()));
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
                .andExpect(jsonPath("$.missingKinds.length()").value(1));
    }

    @Test
    @DisplayName("the reviewer can read the owner's vault for the listing; the owner reads it at /me")
    void staffCanListTheOwnersDocumentsForTheListing() throws Exception {
        Property listing = listing(user("9820000629", Roles.Wire.OWNER));
        String staff = bearer(user("9820000630", Roles.Wire.STAFF));
        String owner = bearer(users.findById(listing.getOwner().getId()).orElseThrow());

        mvc.perform(get(ownership(listing) + "/documents").header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        mvc.perform(get(ownership(listing) + "/documents").header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isForbidden());
    }

    // Only signed URLs from the object store — so this is the only moment the platform can observe
    // a reviewer opening somebody's Aadhaar; a refused-read audit would break the "no hit = no read" reading.
    @Test
    @DisplayName("reading a listing's identity documents is recorded; being refused is not")
    void listingTheVaultLeavesAnAnswerToWhoOpenedTheseScans() throws Exception {
        User ownerUser = user("9820000645", Roles.Wire.OWNER);
        Property listing = listing(ownerUser);
        User staffUser = user("9820000646", Roles.Wire.STAFF);
        vaultFile(listing, "Electricity Bill", "msedcl.pdf");

        mvc.perform(get(ownership(listing) + "/documents")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staffUser)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));

        mvc.perform(get(ownership(listing) + "/documents")
                        .header(HttpHeaders.AUTHORIZATION, bearer(ownerUser)))
                .andExpect(status().isForbidden());

        assertThat(jdbc.queryForObject(
                "select count(*) from audit_log where action = 'property.documents.read'"
                        + " and entity_id = ? and actor = ?", Integer.class,
                listing.getId().toString(), staffUser.getId().toString()))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "select count(*) from audit_log where action = 'property.documents.read'"
                        + " and actor = ?", Integer.class, ownerUser.getId().toString()))
                .isZero();
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
        // Roles are additive: this person works the ops desk and also lets out a flat. @PreAuthorize
        // lets them through, and the maker/checker rule has to stop them.
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

        // Well-formed withdrawal so the refusal is the maker/checker rule and not a missing param.
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
        record(listing, staff, "electricity_bill", recent);
        record(listing, staff, "aadhaar", recent);
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

        // jdbc and the persistence context share this test's transaction but not its dirty state,
        // so without this flush the raw read reports whatever JPA last happened to write.
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
        // is not necessarily whoever's Aadhaar was sighted, and which ID is personal data itself.
        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence[0].kind").value("owner_identity"))
                .andExpect(jsonPath("$.evidence[0].current").value(true))
                .andExpect(jsonPath("$.evidence[0].docType").doesNotExist())
                .andExpect(jsonPath("$.evidence[0].documentId").doesNotExist())
                .andExpect(jsonPath("$.evidence[0].subjectName").doesNotExist())
                .andExpect(jsonPath("$.missingKinds.length()").value(1));
    }

    // Counterweight: reviews() must separate "on staff" from "reviews properties" so packers, loans
    // and interiors desks — still staff, still passing the role guard — see the redacted owner view.
    @Test
    @DisplayName("a staff account without properties:write reads the redacted case file, not the reviewer's")
    void aDeskThatDoesNotReviewPropertiesIsWithheldTheDocumentType() throws Exception {
        Property listing = listing(user("9820000679", Roles.Wire.OWNER));
        User reviewer = user("9820000680", Roles.Wire.STAFF);
        record(listing, bearer(reviewer), "aadhaar", Instant.now().minus(3, ChronoUnit.DAYS));

        User ticketDesk = user("9820000681", Roles.Wire.STAFF);
        jdbc.update("INSERT INTO back_office_permissions (user_id, permissions) VALUES (?::uuid, ?::jsonb)",
                ticketDesk.getId().toString(), "[\"dashboard:read\",\"tickets:read\",\"tickets:write\"]");

        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, bearer(ticketDesk)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence[0].kind").value("owner_identity"))
                .andExpect(jsonPath("$.evidence[0].docType").doesNotExist())
                .andExpect(jsonPath("$.evidence[0].documentId").doesNotExist())
                .andExpect(jsonPath("$.evidence[0].subjectName").doesNotExist());
    }

    // An owner_identity row that records that a government ID was sighted without recording whose
    // is not evidence — there is nothing for a later dispute to check it against.
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

        // A deed names a person too, but the deed itself answers who, so the name is optional
        // there. Dated a day earlier so the case file's newest-first order is decided rather than incidental.
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

    // Pinned from both ends: the wire carries a day, the server decides which midnight it means.
    // Two reviewers who typed the same date must not get expiries five and a half hours apart.
    @Test
    @DisplayName("the issue date is a day, anchored to IST rather than to the caller's midnight")
    void anIssueDateIsACalendarDayReckonedInIst() throws Exception {
        Property listing = listing(user("9820000647", Roles.Wire.OWNER));
        String staff = bearer(user("9820000648", Roles.Wire.STAFF));
        LocalDate today = LocalDate.now(PlatformTime.IST);

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"docType\":\"electricity_bill\",\"issuedOn\":\"" + today + "\"}"))
                .andExpect(status().isCreated());

        Instant istMidnight = today.atStartOfDay(PlatformTime.IST).toInstant();
        assertThat(jdbc.queryForObject("select issued_at from property_ownership_evidence"
                + " where property_id = ?", java.sql.Timestamp.class, listing.getId()).toInstant())
                .isEqualTo(istMidnight);
        assertThat(jdbc.queryForObject("select expires_at from property_ownership_evidence"
                + " where property_id = ?", java.sql.Timestamp.class, listing.getId()).toInstant())
                .isEqualTo(istMidnight.plus(90, ChronoUnit.DAYS));

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"docType\":\"electricity_bill\",\"issuedOn\":\""
                                + today.plusDays(1) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString("future")));
    }

    // Expiry runs from the issue date so a stale receipt cannot mint a badge good for another 90
    // days; the clock check alone would leave the same file re-citable every quarter with a fresh date.
    @Test
    @DisplayName("a cited document cannot be dated after the day it was uploaded")
    void anIssueDateCannotPostDateTheUpload() throws Exception {
        Property listing = listing(user("9820000631", Roles.Wire.OWNER));
        String staff = bearer(user("9820000632", Roles.Wire.STAFF));
        Document bill = documents.saveAndFlush(new Document(listing.getId(), "Electricity Bill",
                "msedcl.pdf", "documents/" + listing.getId() + "/" + java.util.UUID.randomUUID(),
                2048L, "application/pdf"));
        Instant filed = Instant.now().minus(700, ChronoUnit.DAYS);
        jdbc.update("update documents set uploaded_at = ? where id = ?",
                java.sql.Timestamp.from(filed), bill.getId());
        // The row was written through this persistence context; without evicting it the service
        // would read the cached instance and miss the backdated upload.
        entities.clear();

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(citedEvidenceBody("electricity_bill", Instant.now().minus(1, ChronoUnit.DAYS), bill)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString("post-date the upload")));

        // The same file read honestly — issued before it was filed — is still perfectly good evidence.
        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(citedEvidenceBody("electricity_bill", filed.minus(2, ChronoUnit.DAYS), bill)))
                .andExpect(status().isCreated());
    }

    // Owner's own file label is a second statement about the contents; disagreement is the cheapest
    // signal the wrong vault row was clicked. Asserted both ways so unrecognised labels stay accepted.
    @Test
    @DisplayName("a document filed as a bill cannot be cited as the registry's own extract")
    void aCitationCannotContradictTheDocumentsOwnLabel() throws Exception {
        Property listing = listing(user("9820000641", Roles.Wire.OWNER), "buy");
        String staff = bearer(user("9820000642", Roles.Wire.STAFF));
        Document bill = documents.saveAndFlush(new Document(listing.getId(), "Electricity Bill",
                "msedcl.pdf", "documents/" + listing.getId() + "/" + java.util.UUID.randomUUID(),
                2048L, "application/pdf"));
        Document noc = documents.saveAndFlush(new Document(listing.getId(), "Society NOC",
                "noc.pdf", "documents/" + listing.getId() + "/" + java.util.UUID.randomUUID(),
                2048L, "application/pdf"));
        Instant issued = Instant.now().minus(1, ChronoUnit.DAYS);

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(citedEvidenceBody("index_ii", issued, bill)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString("Electricity Bill")));

        // Gate is untouched by the refusal: title_proof is still outstanding. Asserting only the
        // 400 would pass against a version that refused and recorded anyway.
        mvc.perform(post(ownership(listing))
                        .header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString("title_proof")));

        // The same file, read honestly, is still perfectly good address proof.
        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(citedEvidenceBody("electricity_bill", issued, bill)))
                .andExpect(status().isCreated());

        // A label naming no evidence type says nothing either way, and the reviewer has opened the
        // file — a scanned Index II filed under the society's NOC is theirs to accept.
        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(citedEvidenceBody("index_ii", issued, noc)))
                .andExpect(status().isCreated());
    }

    // Keying the write on whether the badge was still live would leave the grant date standing and
    // log nothing — the case an investigation most needs is exactly the discovery after expiry.
    @Test
    @DisplayName("a lapsed badge can still be withdrawn, and the withdrawal is recorded")
    void aLapsedBadgeCanStillBeWithdrawn() throws Exception {
        Property listing = listing(user("9820000633", Roles.Wire.OWNER));
        String staff = bearer(user("9820000634", Roles.Wire.STAFF));
        listing.verifyOwnership(Instant.now().minus(200, ChronoUnit.DAYS),
                Instant.now().minus(1, ChronoUnit.DAYS));
        properties.saveAndFlush(listing);

        mvc.perform(delete(ownership(listing))
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .param("reason", "index II turned out to be forged"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(false))
                .andExpect(jsonPath("$.verifiedAt").doesNotExist());

        properties.flush();
        assertThat(jdbc.queryForObject(
                "select ownership_verified from properties where id = ?", Boolean.class, listing.getId()))
                .isFalse();
        assertThat(jdbc.queryForObject(
                "select count(*) from audit_log where action = 'property.ownership.revoked'"
                        + " and entity_id = ?", Integer.class, listing.getId().toString()))
                .isEqualTo(1);
    }

    /** A free-text reason travels in the URL, and URLs end up in logs that audit_log's rules do not reach. */
    @Test
    @DisplayName("a withdrawal reason is length-capped")
    void aWithdrawalReasonIsCapped() throws Exception {
        Property listing = listing(user("9820000635", Roles.Wire.OWNER));
        String staff = bearer(user("9820000636", Roles.Wire.STAFF));

        mvc.perform(delete(ownership(listing))
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .param("reason", "x".repeat(301)))
                .andExpect(status().isBadRequest());
    }

    // ownershipVerifiedAt is handed to the announcer and held against billing's referral credit; a
    // quarterly renewal that moved it would leave the two sides naming different moments.
    @Test
    @DisplayName("renewing a live badge extends the expiry but keeps the original grant date")
    void aRenewalKeepsTheOriginalGrantDate() throws Exception {
        Property listing = listing(user("9820000637", Roles.Wire.OWNER), "rent");
        String staff = bearer(user("9820000638", Roles.Wire.STAFF));

        record(listing, staff, "electricity_bill", Instant.now().minus(80, ChronoUnit.DAYS));
        String first = mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String grantedAt = com.jayway.jsonpath.JsonPath.read(first, "$.verifiedAt");
        String firstUntil = com.jayway.jsonpath.JsonPath.read(first, "$.verifiedUntil");

        // A fresh bill arrives before the old one lapses.
        record(listing, staff, "electricity_bill", Instant.now().minus(1, ChronoUnit.DAYS));
        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verifiedAt").value(grantedAt))
                .andExpect(jsonPath("$.verifiedUntil")
                        .value(org.hamcrest.Matchers.not(firstUntil)));
    }

    // The reviewer picks from /documents, which hides service-request uploads; a citable-but-not-
    // listable id is one the two halves of the feature disagree about.
    @Test
    @DisplayName("evidence cannot cite a document the reviewer was never shown")
    void evidenceCannotCiteAServiceRequestDocument() throws Exception {
        Property listing = listing(user("9820000639", Roles.Wire.OWNER));
        String staff = bearer(user("9820000640", Roles.Wire.STAFF));
        java.util.UUID request = java.util.UUID.randomUUID();
        jdbc.update("insert into service_requests (id, type, team, property_id)"
                + " values (?, 'packers', 'packers', ?)", request, listing.getId());
        Document packersQuote = documents.saveAndFlush(new Document(listing.getId(),
                request, "Quote", "quote.pdf",
                "documents/" + listing.getId() + "/" + java.util.UUID.randomUUID(),
                2048L, "application/pdf"));

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(citedEvidenceBody("electricity_bill",
                                Instant.now().minus(1, ChronoUnit.DAYS), packersQuote)))
                .andExpect(status().isBadRequest());
    }

    private String citedEvidenceBody(String docType, Instant issuedAt, Document cited) {
        return "{\"docType\":\"" + docType + "\",\"issuedOn\":\"" + istDay(issuedAt) + "\","
                + "\"documentId\":\"" + cited.getId() + "\"}";
    }

    private Document vaultFile(Property listing, String category, String fileName) {
        return documents.saveAndFlush(new Document(listing.getId(), category, fileName,
                "documents/" + listing.getId() + "/" + java.util.UUID.randomUUID(),
                2048L, "application/pdf"));
    }

    // ownership_evidence.document_id is ON DELETE SET NULL, so if the cited file were deletable the
    // badge could stand while pointing at nothing; the whole arc is the point, refuse-only would look identical to the owner losing their vault.
    @Test
    @DisplayName("a file behind a live badge survives its owner, until the badge does not")
    void theArtefactBehindALiveBadgeCannotBeDeleted() throws Exception {
        User ownerUser = user("9820000643", Roles.Wire.OWNER);
        String owner = bearer(ownerUser);
        Property listing = listing(ownerUser);
        String staff = bearer(user("9820000644", Roles.Wire.STAFF));
        Document bill = vaultFile(listing, "Electricity Bill", "msedcl.pdf");
        Document spare = vaultFile(listing, "Society NOC", "noc.pdf");
        String prop = listing.getId().toString();

        // Nothing cites the spare, and the gate has no opinion about it — deleting paperwork from
        // your own listing is ordinary, and must stay ordinary.
        mvc.perform(delete(Routes.MeDocuments.BY_ID, prop, spare.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isNoContent());

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(citedEvidenceBody("electricity_bill", Instant.now().minus(1, ChronoUnit.DAYS), bill)))
                .andExpect(status().isCreated());
        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true));

        mvc.perform(delete(Routes.MeDocuments.BY_ID, prop, bill.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString("Ownership")));
        // Refused, not merely reported as refused: a 409 written after the delete would read the
        // same on the wire and leave the badge pointing at nothing.
        assertThat(documents.findById(bill.getId())).isPresent();

        mvc.perform(delete(ownership(listing))
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .param("reason", "owner asked to remove the bill"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(false));

        // The claim has stopped, so the file is the owner's again — and its going is now on the
        // record, which is what an investigation into the withdrawn verdict would come looking for.
        mvc.perform(delete(Routes.MeDocuments.BY_ID, prop, bill.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isNoContent());
        assertThat(documents.findById(bill.getId())).isEmpty();
        assertThat(jdbc.queryForObject(
                "select count(*) from audit_log where action = 'property.document.evidence.deleted'"
                        + " and entity_id = ?", Integer.class, bill.getId().toString()))
                .isEqualTo(1);
        // The spare was never evidence, so deleting it must not have written one.
        assertThat(jdbc.queryForObject(
                "select count(*) from audit_log where action = 'property.document.evidence.deleted'"
                        + " and entity_id = ?", Integer.class, spare.getId().toString()))
                .isZero();
    }
}
