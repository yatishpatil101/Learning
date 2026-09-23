package com.draazy.api.documents;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.documents.agreement.RentAgreementRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/** The status is the desk's to set, one rung at a time, because another slice reads it as proof —
 *  see {@code RentAgreementStatuses}. */
class AgreementsAndKycTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    RentAgreementRepository agreements;

    private User user(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    private static String agreementBody(Property p) {
        return "{\"propertyId\":\"" + p.getId() + "\",\"tenantMobile\":\"9876543210\","
                + "\"rent\":25000,\"deposit\":100000,\"startDate\":\"2026-04-01\","
                + "\"durationMonths\":11}";
    }

    @Test
    void createAgreement_returnsTheServerAssignedRecord() throws Exception {
        User owner = user("9820003001");
        Property p = listing(owner, "Agreement flat");

        mvc.perform(post(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(agreementBody(p)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(jsonPath("$.propertyId").value(p.getId().toString()))
                .andExpect(jsonPath("$.durationMonths").value(11))
                .andExpect(jsonPath("$.status").value("draft"));
    }

    @Test
    void createAgreement_ignoresAClientSuppliedStatusAndDocumentUrl() throws Exception {
        User owner = user("9820003002");
        Property p = listing(owner, "Self certify flat");

        // RentAgreementCreate has no status/documentUrl, so these are dropped rather than honoured:
        // an agreement claiming to be `registered` would be a forged legal record.
        mvc.perform(post(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId()
                                + "\",\"tenantMobile\":\"9876543210\",\"status\":\"registered\","
                                + "\"documentUrl\":\"https://evil.example/deed.pdf\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("draft"))
                .andExpect(jsonPath("$.documentUrl").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    void createAgreement_isA404OnSomeoneElsesListing() throws Exception {
        User owner = user("9820003003");
        User stranger = user("9820003004");
        Property p = listing(owner, "Not yours");

        mvc.perform(post(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(agreementBody(p)))
                .andExpect(status().isNotFound());
    }

    @Test
    void createAgreement_refusesATenantMobileThatIsNotOne() throws Exception {
        User owner = user("9820003005");
        Property p = listing(owner, "Bad mobile flat");

        // The same pattern guards the edge and the V6 CHECK, so a bad number cannot reach the table
        // and surface later as a 500.
        mvc.perform(post(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"tenantMobile\":\"12345\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void myAgreements_hidesAnAgreementTheCallerIsNotAPartyTo() throws Exception {
        User owner = user("9820003006");
        User otherOwner = user("9820003007");
        mvc.perform(post(Routes.MeRentAgreements.BASE)
                .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content(agreementBody(listing(owner, "Mine"))));
        mvc.perform(post(Routes.MeRentAgreements.BASE)
                .header(HttpHeaders.AUTHORIZATION, bearer(otherOwner))
                .contentType(MediaType.APPLICATION_JSON)
                .content(agreementBody(listing(otherOwner, "Theirs"))));

        // Neither landlord is the tenant named on the other's agreement, so widening the read to
        // both parties does not widen it to strangers.
        mvc.perform(get(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void myAgreements_includesTheOnesFiledAgainstTheCallerAsTenant() throws Exception {
        User landlord = user("9820003020");
        // agreementBody names 9876543210 as the tenant, and that person is a real account here: a
        // list answering only the landlord would hide the lease from the signatory who lives there.
        User tenant = user("9876543210");
        mvc.perform(post(Routes.MeRentAgreements.BASE)
                .header(HttpHeaders.AUTHORIZATION, bearer(landlord))
                .contentType(MediaType.APPLICATION_JSON)
                .content(agreementBody(listing(landlord, "Rented out"))));

        mvc.perform(get(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].tenantMobile").value("9876543210"));
    }

    @Test
    void myAgreements_matchesTheTenantOnTheirOwnNumberOnly() throws Exception {
        User landlord = user("9820003021");
        User bystander = user("9820003022");
        mvc.perform(post(Routes.MeRentAgreements.BASE)
                .header(HttpHeaders.AUTHORIZATION, bearer(landlord))
                .contentType(MediaType.APPLICATION_JSON)
                .content(agreementBody(listing(landlord, "Not the bystander's"))));

        // The tenant half of the query is an equality on a mobile: this is the assertion that would
        // fail if the null/blank handling ever collapsed into matching every row.
        mvc.perform(get(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(bystander)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void agreementRoutes_requireAuthentication() throws Exception {
        mvc.perform(get(Routes.MeRentAgreements.BASE)).andExpect(status().isUnauthorized());
    }

    /** Ops, holding the {@code services:write} baseline every staff account carries. */
    private User desk(String mobile) {
        User u = new User(mobile, Roles.Wire.STAFF);
        u.setName("Ops desk");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private String fileDraft(User owner, Property p) throws Exception {
        String body = mvc.perform(post(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(agreementBody(p)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        int at = body.indexOf("\"id\":\"") + 6;
        return body.substring(at, body.indexOf('"', at));
    }

    @Test
    void transition_registersADraftAndTurnsItIntoEvidenceTheTrustSweepCanRead() throws Exception {
        User owner = user("9820003030");
        Property p = listing(owner, "Registered flat");
        String id = fileDraft(owner, p);

        // `hasRegisteredTenancy` is how a flatmate host gets the Tenant-verified badge without a
        // human looking, and this route is the only way that status can be written at all.
        assertThat(agreements.hasRegisteredTenancy(p.getId(), "9876543210")).isFalse();

        mvc.perform(patch(Routes.Moderation.RENT_AGREEMENT_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk("9877730001")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"registered\","
                                + "\"documentUrl\":\"https://cdn.draazy.test/ll.pdf\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("registered"))
                .andExpect(jsonPath("$.documentUrl").value("https://cdn.draazy.test/ll.pdf"));

        assertThat(agreements.hasRegisteredTenancy(p.getId(), "9876543210")).isTrue();
    }

    @Test
    void transition_refusesAMoveTheLadderDoesNotAllowAndNamesTheOnesItDoes() throws Exception {
        User owner = user("9820003031");
        String id = fileDraft(owner, listing(owner, "Backwards flat"));
        String desk = bearer(desk("9877730002"));

        mvc.perform(patch(Routes.Moderation.RENT_AGREEMENT_BY_ID, id)
                .header(HttpHeaders.AUTHORIZATION, desk)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"registered\"}")).andExpect(status().isOk());

        // 422 rather than 400 — the body is fine, the order is not, and only the stored row knows
        // that: the sub-registrar's record does not change because ops clicked.
        mvc.perform(patch(Routes.Moderation.RENT_AGREEMENT_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, desk)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"draft\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString("active or expired")));
    }

    @Test
    void transition_isNotTheOwnersToMake() throws Exception {
        User owner = user("9820003032");
        String id = fileDraft(owner, listing(owner, "Self-registered flat"));

        // Why this lives under /admin: an owner who could set `registered` on their own record
        // could badge themselves Tenant-verified off a document nobody ever filed.
        mvc.perform(patch(Routes.Moderation.RENT_AGREEMENT_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"registered\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void transition_refusesAStatusThatIsNotOne() throws Exception {
        User owner = user("9820003033");
        String id = fileDraft(owner, listing(owner, "Made-up status flat"));

        // Caught before the row is read, because the V6 CHECK would otherwise turn a typo into a
        // 500 at flush time.
        mvc.perform(patch(Routes.Moderation.RENT_AGREEMENT_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk("9877730003")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"notarised\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void transition_refusesADocumentLinkThatIsNotAnHttpsScan() throws Exception {
        User owner = user("9820003034");
        String id = fileDraft(owner, listing(owner, "Bad link flat"));

        // This URL is handed back to both parties as the thing to click to read their own tenancy,
        // so a javascript: one runs in the session of somebody with every reason to trust it.
        mvc.perform(patch(Routes.Moderation.RENT_AGREEMENT_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk("9877730004")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"registered\","
                                + "\"documentUrl\":\"javascript:alert(1)\"}"))
                .andExpect(status().isUnprocessableEntity());

        assertThat(agreements.findById(UUID.fromString(id)).orElseThrow().getStatus())
                .isEqualTo("draft");
    }

    @Test
    void getKyc_returnsAnEmptyPendingRecordBeforeAnythingIsSubmitted() throws Exception {
        User owner = user("9820003010");

        // A 200 with an empty record, not a 404: "you have not done KYC yet" is a state of your own
        // account, and a 404 would force every client to treat a first visit as an error.
        mvc.perform(get(Routes.MeOwnerKyc.BASE).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.bankVerified").value(false))
                .andExpect(jsonPath("$.panMasked").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    void saveKyc_storesOnlyMasksAndNeverEchoesTheRawIdentifiers() throws Exception {
        User owner = user("9820003011");

        String json = mvc.perform(put(Routes.MeOwnerKyc.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pan\":\"ABCDE1234F\",\"aadhaar\":\"123412341234\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.panMasked").value("XXXXX1234F"))
                .andExpect(jsonPath("$.aadhaarMasked").value("XXXX XXXX 1234"))
                .andReturn().getResponse().getContentAsString();

        org.assertj.core.api.Assertions.assertThat(json)
                .doesNotContain("ABCDE1234F", "123412341234");

        // And the raw values must not reach a column either -- the mask is produced at the edge.
        String storedPan = jdbc.queryForObject(
                "select pan_masked from owner_kyc where user_id = ?", String.class, owner.getId());
        org.assertj.core.api.Assertions.assertThat(storedPan).isEqualTo("XXXXX1234F");
    }

    @Test
    void saveKyc_isAnUpsert_soASecondSubmissionDoesNotFail() throws Exception {
        User owner = user("9820003012");
        for (int i = 0; i < 2; i++) {
            mvc.perform(put(Routes.MeOwnerKyc.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"pan\":\"ABCDE1234F\",\"aadhaar\":\"123412341234\"}"))
                    .andExpect(status().isOk());
        }
    }

    @Test
    void saveKyc_resetsAVerifiedBadgeWhenTheIdentifiersChange() throws Exception {
        User owner = user("9820003013");
        mvc.perform(put(Routes.MeOwnerKyc.BASE)
                .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"pan\":\"ABCDE1234F\",\"aadhaar\":\"123412341234\"}"));
        // Stand in for the provider's verdict, which is the only thing that may set `verified`.
        jdbc.update("update owner_kyc set status = 'verified' where user_id = ?", owner.getId());

        // Verify once with your own PAN, then swap in somebody else's and keep the badge -- that is
        // the attack this reset exists to close.
        mvc.perform(put(Routes.MeOwnerKyc.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pan\":\"ZZZZZ9999Z\",\"aadhaar\":\"999999999999\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.panMasked").value("XXXXX9999Z"));
    }

    @Test
    void saveKyc_refusesAStatusOrBankVerifiedSentByTheClient() throws Exception {
        User owner = user("9820003014");

        // Self-certified KYC is not KYC: OwnerKycUpdate carries no verdict fields, so these are
        // ignored rather than applied.
        mvc.perform(put(Routes.MeOwnerKyc.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pan\":\"ABCDE1234F\",\"aadhaar\":\"123412341234\","
                                + "\"status\":\"verified\",\"bankVerified\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.bankVerified").value(false));
    }

    @Test
    void saveKyc_refusesAMalformedPan() throws Exception {
        User owner = user("9820003015");

        mvc.perform(put(Routes.MeOwnerKyc.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pan\":\"NOT-A-PAN\",\"aadhaar\":\"123412341234\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void kycRoutes_requireAuthentication() throws Exception {
        mvc.perform(get(Routes.MeOwnerKyc.BASE)).andExpect(status().isUnauthorized());
    }

    @Test
    void kycIsSelfScoped_soOneOwnersSubmissionIsInvisibleToAnother() throws Exception {
        User first = user("9820003016");
        User second = user("9820003017");
        mvc.perform(put(Routes.MeOwnerKyc.BASE)
                .header(HttpHeaders.AUTHORIZATION, bearer(first))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"pan\":\"ABCDE1234F\",\"aadhaar\":\"123412341234\"}"));

        mvc.perform(get(Routes.MeOwnerKyc.BASE).header(HttpHeaders.AUTHORIZATION, bearer(second)))
                .andExpect(jsonPath("$.panMasked").value(org.hamcrest.Matchers.nullValue()));
    }
}
