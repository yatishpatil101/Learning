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
        if (Roles.Wire.STAFF.equals(role)) {
            jdbc.update("""
                    INSERT INTO back_office_permissions (user_id, permissions)
                    VALUES (?::uuid, ?::jsonb)
                    ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions
                    """, saved.getId().toString(),
                    "[\"kyc\",\"propertyVerification\",\"listingModeration\",\"support\",\"content\",\"reports\",\"desk:rental\"]");
        }
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
                "aadhaar".equals(docType) || "pan".equals(docType) || "power_of_attorney".equals(docType)
                        ? "Ramesh Kulkarni"
                        : null);
    }

    private String evidenceBody(String docType, Instant issuedAt, String subjectName) {
        return "{\"docType\":\"" + docType + "\",\"issuedOn\":\"" + istDay(issuedAt) + "\""
                + (subjectName == null ? "" : ",\"subjectName\":\"" + subjectName + "\"")
                + "}";
    }

    private static String istDay(Instant at) {
        return at.atZone(PlatformTime.IST).toLocalDate().toString();
    }

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
    @DisplayName("a sale earns the badge on title proof, and the listing starts showing it")
    void aCompleteEvidenceSetEarnsTheBadge() throws Exception {
        Property listing = listing(user("9820000601", Roles.Wire.OWNER), "buy");
        String staff = bearer(user("9820000602", Roles.Wire.STAFF));
        Instant recent = Instant.now().minus(5, ChronoUnit.DAYS);

        mvc.perform(get("/properties/" + listing.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownershipVerified").value(false));

        record(listing, staff, "index_ii", recent);

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true))
                .andExpect(jsonPath("$.missingKinds").isEmpty())
                .andExpect(jsonPath("$.evidence.length()").value(1));

        mvc.perform(get("/properties/" + listing.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownershipVerified").value(true));
    }

    @Test
    @DisplayName("a sale can use a current 7/12 extract as the title proof")
    void aCurrentSatbaraCanCloseTheSaleTitleFact() throws Exception {
        Property listing = listing(user("9820000691", Roles.Wire.OWNER), "buy");
        String staff = bearer(user("9820000692", Roles.Wire.STAFF));
        Instant recent = Instant.now().minus(5, ChronoUnit.DAYS);

        record(listing, staff, "satbara_7_12", recent);

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true))
                .andExpect(jsonPath("$.missingKinds").isEmpty())
                .andExpect(jsonPath("$.evidence[?(@.docType=='satbara_7_12')].kind")
                        .value(org.hamcrest.Matchers.contains("title_proof")));
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
    @DisplayName("a rental can also earn the badge on title proof alone")
    void aRentalCanUseTitleProof() throws Exception {
        Property listing = listing(user("9820000693", Roles.Wire.OWNER));
        String staff = bearer(user("9820000694", Roles.Wire.STAFF));

        record(listing, staff, "share_certificate", Instant.now().minus(5, ChronoUnit.DAYS));

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true))
                .andExpect(jsonPath("$.missingKinds").isEmpty())
                .andExpect(jsonPath("$.evidence[?(@.docType=='share_certificate')].kind")
                        .value(org.hamcrest.Matchers.contains("title_proof")));
    }

    @Test
    @DisplayName("a partial set is refused with the missing facts named, not a bare 400")
    void aPartialSetIsRefusedWithTheMissingFactsNamed() throws Exception {
        Property listing = listing(user("9820000603", Roles.Wire.OWNER), "buy");
        String staff = bearer(user("9820000604", Roles.Wire.STAFF));

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
    @DisplayName("a sale deed plus a bill does not earn the badge — the sale rule needs title proof")
    void aSaleDeedDoesNotStandInForIndexII() throws Exception {
        Property listing = listing(user("9820000633", Roles.Wire.OWNER), "buy");
        String staff = bearer(user("9820000634", Roles.Wire.STAFF));
        Instant recent = Instant.now().minus(3, ChronoUnit.DAYS);

        record(listing, staff, "sale_deed", recent);

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("title_proof")));

        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence.length()").value(1))
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

        record(listing, staff, "tax_receipt", Instant.now().minus(400, ChronoUnit.DAYS));

        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("address_or_title_proof")));

        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence.length()").value(1))
                .andExpect(jsonPath("$.missingKinds[0]").value("address_or_title_proof"));
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
                .andExpect(jsonPath("$.verifiedUntil").doesNotExist());
    }

    @Test
    @DisplayName("within one fact the newest document wins — a fresh bill extends the badge")
    void afresherDocumentOfTheSameKindSupersedesTheOlderOne() throws Exception {
        Property listing = listing(user("9820000615", Roles.Wire.OWNER));
        String staff = bearer(user("9820000616", Roles.Wire.STAFF));
        Instant nearlyStale = Instant.now().minus(80, ChronoUnit.DAYS);
        Instant fresh = Instant.now().minus(5, ChronoUnit.DAYS);

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

        assertThat(jdbc.queryForObject(
                "select ownership_verified from properties where id = ?", Boolean.class, listing.getId()))
                .isTrue();

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
        caseFile(listing, "pending", null);

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
        caseFile(listing, "pending", null);

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
    @DisplayName("staff can read ownership documents within 30 days of a decision, but not after")
    void staffDocumentAccessExpiresThirtyDaysAfterDecision() throws Exception {
        Property inside = listing(user("9820000711", Roles.Wire.OWNER));
        Property outside = listing(user("9820000712", Roles.Wire.OWNER));
        String staff = bearer(user("9820000713", Roles.Wire.STAFF));
        caseFile(inside, "approved", Instant.now().minus(29, ChronoUnit.DAYS));
        caseFile(outside, "approved", Instant.now().minus(31, ChronoUnit.DAYS));

        mvc.perform(get(ownership(inside) + "/documents").header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk());

        mvc.perform(get(ownership(outside) + "/documents").header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("document_access_expired"));
    }

    @Test
    @DisplayName("an archived pending listing closes staff document access after the archive window")
    void archivedPendingListingExpiresStaffDocumentAccess() throws Exception {
        Property listing = listing(user("9820000715", Roles.Wire.OWNER));
        String staff = bearer(user("9820000716", Roles.Wire.STAFF));
        caseFile(listing, "pending", null);
        archiveListingAt(listing, Instant.now().minus(31, ChronoUnit.DAYS), "Owner archived");

        mvc.perform(get(ownership(listing) + "/documents").header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("document_access_expired"));
    }

    @Test
    @DisplayName("auto-archived needs-info cases close staff document access after 30 days")
    void autoArchivedNeedsInfoListingExpiresStaffDocumentAccess() throws Exception {
        Property listing = listing(user("9820000717", Roles.Wire.OWNER));
        String staff = bearer(user("9820000718", Roles.Wire.STAFF));
        Instant archivedAt = Instant.now().minus(31, ChronoUnit.DAYS);
        caseFile(listing, "needs_info", Instant.now().minus(45, ChronoUnit.DAYS));
        archiveListingAt(listing, archivedAt, "needs_info_timeout");
        jdbc.update("update property_reviews set needs_info_timeout_archived_at = ? where property_id = ?",
                java.sql.Timestamp.from(archivedAt), listing.getId());

        mvc.perform(get(ownership(listing) + "/documents").header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("document_access_expired"));
    }

    @Test
    @DisplayName("the staff window does not change the owner's own vault access")
    void ownerVaultAccessIsUnchangedAfterTheStaffWindowExpires() throws Exception {
        User ownerUser = user("9820000714", Roles.Wire.OWNER);
        Property listing = listing(ownerUser);
        String owner = bearer(ownerUser);
        caseFile(listing, "rejected", Instant.now().minus(31, ChronoUnit.DAYS));
        vaultFile(listing, "Electricity Bill", "msedcl.pdf");

        mvc.perform(get(Routes.MeDocuments.FOR_PROPERTY, listing.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
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

        mvc.perform(delete(ownership(ownListing))
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .param("reason", "changed my mind"))
                .andExpect(status().isForbidden());

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
        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true));

        mvc.perform(delete(ownership(listing))
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .param("reason", "index II is for a different flat"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(false))
                .andExpect(jsonPath("$.verifiedAt").doesNotExist())
                .andExpect(jsonPath("$.verifiedUntil").doesNotExist())

                .andExpect(jsonPath("$.evidence.length()").value(2));

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

        legacyEvidence(listing, "aadhaar", Instant.now().minus(3, ChronoUnit.DAYS), "Legacy Owner");

        // Ops see the whole file — it is their case.
        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence[0].docType").value("aadhaar"));

        // The owner sees enough to act on and nothing more.
        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence[0].kind").value("owner_identity"))
                .andExpect(jsonPath("$.evidence[0].current").value(true))
                .andExpect(jsonPath("$.evidence[0].docType").doesNotExist())
                .andExpect(jsonPath("$.evidence[0].documentId").doesNotExist())
                .andExpect(jsonPath("$.evidence[0].subjectName").doesNotExist())
                .andExpect(jsonPath("$.missingKinds.length()").value(1));
    }

    @Test
    @DisplayName("a staff account without property verification reads the redacted case file, not the reviewer's")
    void aDeskThatDoesNotReviewPropertiesIsWithheldTheDocumentType() throws Exception {
        Property listing = listing(user("9820000679", Roles.Wire.OWNER));
        User reviewer = user("9820000680", Roles.Wire.STAFF);
        legacyEvidence(listing, "aadhaar", Instant.now().minus(3, ChronoUnit.DAYS), "Legacy Owner");

        User ticketDesk = user("9820000681", Roles.Wire.STAFF);
        jdbc.update("""
                INSERT INTO back_office_permissions (user_id, permissions)
                VALUES (?::uuid, ?::jsonb)
                ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions
                """, ticketDesk.getId().toString(), "[\"support\"]");

        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, bearer(ticketDesk)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence[0].kind").value("owner_identity"))
                .andExpect(jsonPath("$.evidence[0].docType").doesNotExist())
                .andExpect(jsonPath("$.evidence[0].documentId").doesNotExist())
                .andExpect(jsonPath("$.evidence[0].subjectName").doesNotExist());
    }

    @Test
    @DisplayName("legacy identity documents are no longer accepted as listing evidence")
    void legacyIdentityDocumentsAreRefusedAndAuthorityMustNameItsSubject() throws Exception {
        Property listing = listing(user("9820000625", Roles.Wire.OWNER));
        String staff = bearer(user("9820000626", Roles.Wire.STAFF));
        Instant recent = Instant.now().minus(3, ChronoUnit.DAYS);

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(evidenceBody("aadhaar", recent, null)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message")
                        .value("Identity comes from the account's identity verification"));

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(evidenceBody("pan", recent, "   ")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message")
                        .value("Identity comes from the account's identity verification"));

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(evidenceBody("power_of_attorney", recent, null)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString("subjectName")));

        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(jsonPath("$.evidence.length()").value(0));

        record(listing, staff, "index_ii", recent.minus(2, ChronoUnit.DAYS));

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(evidenceBody("power_of_attorney", recent.minus(1, ChronoUnit.DAYS),
                                "  Savita Joshi ")))
                .andExpect(status().isCreated());

        mvc.perform(get(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence.length()").value(2))
                .andExpect(jsonPath("$.evidence[0].docType").value("power_of_attorney"))
                .andExpect(jsonPath("$.evidence[0].kind").value("authority_proof"))
                .andExpect(jsonPath("$.evidence[0].subjectName").value("Savita Joshi"))
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

        entities.clear();

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(citedEvidenceBody("electricity_bill", Instant.now().minus(1, ChronoUnit.DAYS), bill)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString("post-date the upload")));

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(citedEvidenceBody("electricity_bill", filed.minus(2, ChronoUnit.DAYS), bill)))
                .andExpect(status().isCreated());
    }

    // Asserted both ways so unrecognised labels stay accepted.
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

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(citedEvidenceBody("electricity_bill", issued, bill)))
                .andExpect(status().isCreated());

        mvc.perform(post(ownership(listing) + "/evidence")
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(citedEvidenceBody("index_ii", issued, noc)))
                .andExpect(status().isCreated());
    }

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

        record(listing, staff, "electricity_bill", Instant.now().minus(1, ChronoUnit.DAYS));
        mvc.perform(post(ownership(listing)).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verifiedAt").value(grantedAt))
                .andExpect(jsonPath("$.verifiedUntil")
                        .value(org.hamcrest.Matchers.not(firstUntil)));
    }

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

    private void legacyEvidence(Property listing, String docType, Instant issuedAt, String subjectName) {
        jdbc.update("insert into property_ownership_evidence "
                + "(id, created_at, updated_at, property_id, doc_type, issued_at, expires_at, recorded_by, subject_name) "
                + "values (?::uuid, now(), now(), ?::uuid, ?, ?, null, ?::uuid, ?)",
                java.util.UUID.randomUUID().toString(), listing.getId().toString(), docType,
                java.sql.Timestamp.from(istMidnight(issuedAt)), listing.getOwner().getId().toString(), subjectName);
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
    private void caseFile(Property listing, String status, Instant decidedAt) {
        jdbc.update("insert into property_reviews (property_id, status, decided_at, last_message_at)"
                + " values (?, ?, ?, now())",
                listing.getId(), status, decidedAt == null ? null : java.sql.Timestamp.from(decidedAt));
    }

    private void archiveListingAt(Property listing, Instant archivedAt, String reason) {
        jdbc.update("update properties set archived = true, archived_at = ?, archive_reason = ? where id = ?",
                java.sql.Timestamp.from(archivedAt), reason, listing.getId());
    }

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

        assertThat(documents.findById(bill.getId())).isPresent();

        mvc.perform(delete(ownership(listing))
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .param("reason", "owner asked to remove the bill"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(false));

        mvc.perform(delete(Routes.MeDocuments.BY_ID, prop, bill.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isNoContent());
        assertThat(documents.findById(bill.getId())).isEmpty();
        assertThat(jdbc.queryForObject(
                "select count(*) from audit_log where action = 'property.document.evidence.deleted'"
                        + " and entity_id = ?", Integer.class, bill.getId().toString()))
                .isEqualTo(1);

        assertThat(jdbc.queryForObject(
                "select count(*) from audit_log where action = 'property.document.evidence.deleted'"
                        + " and entity_id = ?", Integer.class, spare.getId().toString()))
                .isZero();
    }
}
