package com.draazy.api.documents;

import com.draazy.api.support.AbstractApiTest;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The paperwork records: rent agreements ({@code /me/rent-agreements}) and owner KYC
 * ({@code /me/owner-kyc}).
 *
 * <p>Both are small surfaces whose whole value is in what they refuse: an agreement cannot be filed
 * against a stranger's flat or claim its own status, and KYC never stores or echoes a raw PAN or
 * Aadhaar and never lets the client certify itself.
 */
class AgreementsAndKycTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

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

    // ---------------- POST /me/rent-agreements ----------------

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
        // an agreement that claims to be `registered` with a documentUrl pointing anywhere it liked
        // would be a forged legal record.
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

    // ---------------- GET /me/rent-agreements ----------------

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
        // agreementBody names 9876543210 as the tenant. That person is a real account here, and the
        // agreement is the record of the home they rent — the tenant's own rental hub and document
        // vault are built on it, so a list that only ever answered the landlord would leave the
        // signatory who actually lives there unable to see their own lease.
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

        // The guard that matters: the tenant half of the query is an equality on a mobile, and a
        // caller whose number appears nowhere on the record must match no rows rather than all of
        // them. This is the assertion that would fail if the null/blank handling ever collapsed.
        mvc.perform(get(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(bystander)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void agreementRoutes_requireAuthentication() throws Exception {
        mvc.perform(get(Routes.MeRentAgreements.BASE)).andExpect(status().isUnauthorized());
    }

    // ---------------- /me/owner-kyc ----------------

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
