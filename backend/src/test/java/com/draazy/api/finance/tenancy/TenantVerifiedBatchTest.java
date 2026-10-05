package com.draazy.api.finance.tenancy;

import com.draazy.api.support.AbstractApiTest;
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
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/** {@code POST /tenant-profiles/verified}. Every refusal must look identical, or the endpoint
 *  becomes an oracle for which of ten billion mobile numbers are registered. */
@DisplayName("The batch verified-tenant badge — one bit per row, and never a fourth answer")
class TenantVerifiedBatchTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired TenantProfileRepository profiles;

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Batch User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property rentListing(User owner) {
        Property p = new Property(owner, "Let listing", "rent", "apartment", 26000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("900"));
        return properties.saveAndFlush(p);
    }

    /** Opens a tenancy the only way the platform allows — by closing a rent deal. */
    private void closeRentDeal(User owner, Property p, User tenant) throws Exception {
        mvc.perform(post("/me/deals/" + p.getId() + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":26000,\"counterpartyMobile\":\""
                                + tenant.getMobile() + "\"}"))
                .andExpect(status().isOk());
    }

    private void saveProfile(User tenant, String name) throws Exception {
        mvc.perform(put(Routes.Tenancies.MY_PROFILE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + name + "\",\"income\":90000}"))
                .andExpect(status().isOk());
    }

    /** Through the repository, not raw SQL: the profile may still be an unflushed insert, and an
     *  {@code UPDATE} behind Hibernate's back would match no row and quietly award nothing. */
    private void awardBadge(User tenant) {
        TenantProfile profile = profiles.findById(tenant.getId()).orElseThrow();
        profile.setVerified(true);
        profiles.saveAndFlush(profile);
    }

    private String batchOf(String... mobiles) {
        String list = java.util.Arrays.stream(mobiles)
                .map(m -> m == null ? "null" : "\"" + m + "\"")
                .collect(Collectors.joining(","));
        return "{\"mobiles\":[" + list + "]}";
    }

    @Test
    void aLandlordSeesTheBadgeOfTheirOwnVerifiedTenant() throws Exception {
        User owner = user("9822300001", "owner");
        User tenant = user("9822300002", "buyer");
        Property p = rentListing(owner);
        saveProfile(tenant, "Asha K");
        awardBadge(tenant);

        // Before the tenancy the landlord is just another stranger, and a stranger is told nothing.
        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batchOf(tenant.getMobile())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].verified").value(false));

        closeRentDeal(owner, p, tenant);

        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batchOf(tenant.getMobile())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].verified").value(true));
    }

    /** All five cases in one response on purpose: asserted separately, the shapes could drift apart
     *  without failing, and any difference between them confirms who is registered. */
    @Test
    void everyRefusalIsTheSameRefusal() throws Exception {
        User owner = user("9822300003", "owner");
        User myTenant = user("9822300004", "buyer");
        User unverifiedTenant = user("9822300005", "buyer");
        User verifiedStranger = user("9822300006", "buyer");

        saveProfile(myTenant, "Asha K");
        awardBadge(myTenant);
        saveProfile(unverifiedTenant, "Bela M");
        saveProfile(verifiedStranger, "Chetan R");
        awardBadge(verifiedStranger);

        closeRentDeal(owner, rentListing(owner), myTenant);
        closeRentDeal(owner, rentListing(owner), unverifiedTenant);

        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batchOf(
                                myTenant.getMobile(),
                                verifiedStranger.getMobile(),
                                unverifiedTenant.getMobile(),
                                "9876500099",
                                "not-a-mobile")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(5))
                .andExpect(jsonPath("$[0].verified").value(true))
                .andExpect(jsonPath("$[1].verified").value(false))
                .andExpect(jsonPath("$[2].verified").value(false))
                .andExpect(jsonPath("$[3].verified").value(false))
                .andExpect(jsonPath("$[4].verified").value(false));
    }

    /** The only numbers this endpoint emits are the ones it was handed, as typed, which is what keeps
     *  it from ever revealing a mobile the caller did not already have. Both answers on the same pair
     *  in one test, so relaxing the batch's relationship guard fails here rather than shipping as a
     *  bypass of the per-item read. */
    @Test
    void aRowCarriesTheFlagAndTheCallersOwnInputAndNothingElse() throws Exception {
        User owner = user("9822300007", "owner");
        User tenant = user("9822300008", "buyer");
        saveProfile(tenant, "Asha K");
        awardBadge(tenant);
        closeRentDeal(owner, rentListing(owner), tenant);

        String asTyped = "+91 " + tenant.getMobile().substring(0, 5) + " "
                + tenant.getMobile().substring(5);

        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batchOf(asTyped)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].*", Matchers.hasSize(2)))
                .andExpect(jsonPath("$[0].mobile").value(asTyped))
                .andExpect(jsonPath("$[0].verified").value(true))
                .andExpect(jsonPath("$[0].name").doesNotExist())
                .andExpect(jsonPath("$[0].income").doesNotExist())
                .andExpect(jsonPath("$[0].score").doesNotExist())
                .andExpect(jsonPath("$[0].occupation").doesNotExist())
                .andExpect(jsonPath("$[0].reason").doesNotExist());
    }

    /** A tenant asking about themselves is the one caller who never needs a relationship. */
    @Test
    void aBatchLargerThanTheCapIsRefusedAndTheCapItselfIsAccepted() throws Exception {
        User caller = user("9822300011", "owner");

        String[] atTheCap = IntStream.range(0, TenantProfileService.MAX_VERIFIED_BATCH)
                .mapToObj(i -> String.format("98765%05d", i))
                .toArray(String[]::new);
        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batchOf(atTheCap)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(TenantProfileService.MAX_VERIFIED_BATCH));

        String[] overTheCap = IntStream.range(0, TenantProfileService.MAX_VERIFIED_BATCH + 1)
                .mapToObj(i -> String.format("98765%05d", i))
                .toArray(String[]::new);
        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batchOf(overTheCap)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void theAnswerMirrorsTheQuestionIncludingRepeats() throws Exception {
        User owner = user("9822300012", "owner");
        User tenant = user("9822300013", "buyer");
        saveProfile(tenant, "Asha K");
        awardBadge(tenant);
        closeRentDeal(owner, rentListing(owner), tenant);

        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batchOf("9876500099", tenant.getMobile(), tenant.getMobile())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].verified").value(false))
                .andExpect(jsonPath("$[1].verified").value(true))
                .andExpect(jsonPath("$[2].verified").value(true));
    }

    @Test
    void anEmptyBatchIsAnEmptyAnswerRatherThanAnError() throws Exception {
        User caller = user("9822300014", "owner");
        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobiles\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void aMissingListIsARejectedRequestRatherThanAnEmptyAnswer() throws Exception {
        User caller = user("9822300015", "owner");

        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void anAnonymousCallerIsRefused() throws Exception {
        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batchOf("9876500099")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aCallerMayAlwaysSeeTheirOwnBadge() throws Exception {
        User tenant = user("9822300019", "buyer");
        saveProfile(tenant, "Asha K");
        awardBadge(tenant);

        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batchOf(tenant.getMobile())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].verified").value(true));
    }
}
