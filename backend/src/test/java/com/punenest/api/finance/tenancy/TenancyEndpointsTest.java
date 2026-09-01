package com.punenest.api.finance.tenancy;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.JwtService;
import java.math.BigDecimal;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * Contract + behaviour proof for the tenancy lifecycle and tenant screening profile (S5.4).
 *
 * <p>The load-bearing tests here are the ones that would let somebody read a stranger's income:
 * {@code GET /tenant-profiles/{mobile}} must answer 404 for an unrelated caller, for an unknown
 * mobile and for a malformed one alike, because any response that tells those cases apart turns the
 * endpoint into the mobile-enumeration oracle spec fix S10 exists to close.
 *
 * <p>Also covers D1 — a tenancy opens when a rent deal closes and ends when it is reopened — and
 * the server-owned score and verified flag (spec fix S17).
 */
class TenancyEndpointsTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired TenancyRepository tenancies;
    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping handlerMapping;

    // ---- helpers ----

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Tenancy User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property rentListing(User owner) {
        Property p = new Property(owner, "Let listing", "rent", "apartment", 28000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        return properties.saveAndFlush(p);
    }

    private Property saleListing(User owner) {
        Property p = new Property(owner, "Sale listing", "buy", "apartment", 9500000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("3"));
        p.setStatus("approved");
        p.setPriceUnit("total");
        p.setArea(new BigDecimal("1400"));
        return properties.saveAndFlush(p);
    }

    private void closeDeal(User owner, Property p, String counterpartyMobile, long price)
            throws Exception {
        mvc.perform(post("/me/deals/" + p.getId() + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":" + price + ",\"counterpartyMobile\":\""
                                + counterpartyMobile + "\"}"))
                .andExpect(status().isOk());
    }

    // ---- 1 (D1): closing a rent deal opens the tenancy, in the same transaction ----

    @Test
    void closingARentDeal_opensATenancyForARegisteredTenant() throws Exception {
        User owner = user("9822200001", "owner");
        User tenant = user("9822200002", "buyer");
        Property p = rentListing(owner);

        closeDeal(owner, p, tenant.getMobile(), 28000L);

        assertThat(tenancies.findActiveByPropertyId(p.getId())).isPresent();

        // The tenant sees it on their side...
        mvc.perform(get(Routes.Tenancies.MINE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].propertyId").value(p.getId().toString()))
                .andExpect(jsonPath("$[0].rent").value(28000))
                .andExpect(jsonPath("$[0].status").value(TenancyStatuses.ACTIVE));

        // ...and the owner sees it on theirs. One entity, two participant projections.
        mvc.perform(get(Routes.Tenancies.OWNED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].tenant.id").value(tenant.getId().toString()))
                .andExpect(jsonPath("$[0].owner.id").value(owner.getId().toString()));
    }

    /**
     * A close naming a mobile with no account is normal for a Pune owner who found the tenant
     * through a broker. There is no user row to point {@code tenant_id} at, so the deal closes
     * without a tenancy rather than the platform inventing a shadow user.
     */
    @Test
    void closingARentDeal_offPlatformTenant_opensNoTenancyButStillCloses() throws Exception {
        User owner = user("9822200003", "owner");
        Property p = rentListing(owner);

        closeDeal(owner, p, "9876500001", 22000L);

        assertThat(tenancies.findActiveByPropertyId(p.getId())).isEmpty();
        mvc.perform(get("/me/deals/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.status").value("closed"));
    }

    /** A sale has no ongoing relationship to model, so no tenancy is opened. */
    @Test
    void closingABuyDeal_opensNoTenancy() throws Exception {
        User owner = user("9822200004", "owner");
        User buyer = user("9822200005", "buyer");
        Property p = saleListing(owner);

        closeDeal(owner, p, buyer.getMobile(), 9500000L);

        assertThat(tenancies.findActiveByPropertyId(p.getId())).isEmpty();
    }

    // ---- 2 (D1): reopening ends the tenancy so the flat can be let again ----

    @Test
    void reopeningARentDeal_endsTheTenancyAndFreesTheProperty() throws Exception {
        User owner = user("9822200006", "owner");
        User tenant = user("9822200007", "buyer");
        Property p = rentListing(owner);
        closeDeal(owner, p, tenant.getMobile(), 28000L);

        mvc.perform(post("/me/deals/" + p.getId() + "/reopen")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk());

        // Ended, not deleted: who lived there is the record, and rent payments hang off that row.
        assertThat(tenancies.findActiveByPropertyId(p.getId())).isEmpty();
        assertThat(tenancies.findByPropertyId(p.getId()))
                .singleElement()
                .satisfies(t -> {
                    assertThat(t.getStatus()).isEqualTo(TenancyStatuses.ENDED);
                    assertThat(t.getEndDate()).isNotNull();
                });

        // ...and the flat can be let again, which the unique index would block if it were still
        // active.
        User next = user("9822200008", "buyer");
        closeDeal(owner, p, next.getMobile(), 30000L);
        assertThat(tenancies.findActiveByPropertyId(p.getId())).isPresent();
    }

    // ---- 3: tenancy lists are participant-scoped ----

    @Test
    void tenancyLists_areParticipantScoped() throws Exception {
        User owner = user("9822200009", "owner");
        User tenant = user("9822200010", "buyer");
        User stranger = user("9822200011", "buyer");
        Property p = rentListing(owner);
        closeDeal(owner, p, tenant.getMobile(), 28000L);

        mvc.perform(get(Routes.Tenancies.MINE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        mvc.perform(get(Routes.Tenancies.OWNED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void tenancyListsRequireAuthentication() throws Exception {
        mvc.perform(get(Routes.Tenancies.MINE)).andExpect(status().isUnauthorized());
        mvc.perform(get(Routes.Tenancies.OWNED)).andExpect(status().isUnauthorized());
    }

    // ---- 4: the tenant profile round-trips, and the score is server-computed ----

    @Test
    void myProfile_emptyBeforeAnySave() throws Exception {
        User tenant = user("9822200012", "buyer");

        // Not 404: "you have not filled this in yet" is a normal state, and a 404 would force the
        // client to special-case a status code just to render a blank form.
        //
        // The score is absent rather than 0. "Never assessed" and "assessed, scored nothing" are
        // different claims about a person, and the screening meter renders them differently — see
        // updateMyProfile_cannotSetItsOwnScoreOrVerifiedBadge, where a *saved* empty profile does
        // correctly score 0.
        mvc.perform(get(Routes.Tenancies.MY_PROFILE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.score").doesNotExist())
                .andExpect(jsonPath("$.verified").value(false))
                .andExpect(jsonPath("$.name").doesNotExist());
    }

    @Test
    void updateMyProfile_computesTheScoreFromTheStoredFields() throws Exception {
        User tenant = user("9822200013", "buyer");

        // occupation 20 + income 15 + priorLandlord 15 + about 10 + occupants 10 = 70; the Aadhaar
        // badge would add the remaining 30 and this user has none.
        mvc.perform(put(Routes.Tenancies.MY_PROFILE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Asha K\",\"occupation\":\"Software Engineer\","
                                + "\"income\":95000,\"occupants\":\"family\","
                                + "\"priorLandlord\":\"Mr Kulkarni 9876500002\","
                                + "\"about\":\"Quiet family of three.\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.score").value(70))
                .andExpect(jsonPath("$.verified").value(false))
                .andExpect(jsonPath("$.occupants").value(OccupantTypes.FAMILY))
                .andExpect(jsonPath("$.income").value(95000));
    }

    /**
     * The score and the verified badge are the whole reason an owner trusts the profile, so a
     * tenant sending them must not be able to set them (spec fix S17).
     */
    @Test
    void updateMyProfile_cannotSetItsOwnScoreOrVerifiedBadge() throws Exception {
        User tenant = user("9822200014", "buyer");

        mvc.perform(put(Routes.Tenancies.MY_PROFILE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Chancer\",\"score\":100,\"verified\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.score").value(0))
                .andExpect(jsonPath("$.verified").value(false));
    }

    /** PUT replaces: a field the tenant removed from the form must actually go. */
    @Test
    void updateMyProfile_replacesRatherThanMerges() throws Exception {
        User tenant = user("9822200015", "buyer");
        mvc.perform(put(Routes.Tenancies.MY_PROFILE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Asha K\",\"about\":\"Some text\"}"))
                .andExpect(status().isOk());

        mvc.perform(put(Routes.Tenancies.MY_PROFILE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Asha K\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.about").doesNotExist());
    }

    @Test
    void updateMyProfile_rejectsAnUnknownOccupantType() throws Exception {
        User tenant = user("9822200016", "buyer");

        // An unrecognised value is not a harmless typo — it would silently drop the tenant out of
        // every owner's screening filter.
        mvc.perform(put(Routes.Tenancies.MY_PROFILE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"occupants\":\"students\"}"))
                .andExpect(status().isBadRequest());
    }

    // ---- 5 (spec fix S10): the mobile-keyed read is relationship-guarded ----

    @Test
    void profileByMobile_unrelatedCaller_returns404NotForbidden() throws Exception {
        User tenant = user("9822200017", "buyer");
        User stranger = user("9822200018", "owner");
        mvc.perform(put(Routes.Tenancies.MY_PROFILE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Asha K\",\"income\":95000}"))
                .andExpect(status().isOk());

        mvc.perform(get("/tenant-profiles/" + tenant.getMobile())
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

    /**
     * The three refusals must be indistinguishable. If "no such number" answered differently from
     * "that number exists but you may not see it", the endpoint would confirm which of the ten
     * billion mobiles are registered — keyed by the exact identifier the contact gate protects.
     */
    @Test
    void profileByMobile_unknownAndMalformedMobiles_answerTheSameAsARefusal() throws Exception {
        User caller = user("9822200019", "owner");

        mvc.perform(get("/tenant-profiles/9876500099")
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isNotFound());

        mvc.perform(get("/tenant-profiles/not-a-mobile")
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isNotFound());
    }

    @Test
    void profileByMobile_landlordOfTheTenant_maySeeIt() throws Exception {
        User owner = user("9822200020", "owner");
        User tenant = user("9822200021", "buyer");
        Property p = rentListing(owner);
        mvc.perform(put(Routes.Tenancies.MY_PROFILE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Asha K\",\"occupation\":\"Doctor\",\"income\":150000}"))
                .andExpect(status().isOk());

        // Before the tenancy exists the landlord is just another stranger.
        mvc.perform(get("/tenant-profiles/" + tenant.getMobile())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNotFound());

        closeDeal(owner, p, tenant.getMobile(), 28000L);

        mvc.perform(get("/tenant-profiles/" + tenant.getMobile())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Asha K"))
                .andExpect(jsonPath("$.income").value(150000));
    }

    /** A screening owner reads the profile, not the number — the contact gate still applies. */
    @Test
    void profileByMobile_masksTheMobileForAScreeningOwner() throws Exception {
        User owner = user("9822200022", "owner");
        User tenant = user("9822200023", "buyer");
        Property p = rentListing(owner);
        mvc.perform(put(Routes.Tenancies.MY_PROFILE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Asha K\"}"))
                .andExpect(status().isOk());
        closeDeal(owner, p, tenant.getMobile(), 28000L);

        mvc.perform(get("/tenant-profiles/" + tenant.getMobile())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mobile").value(org.hamcrest.Matchers.containsString("XXXXX")));
    }

    @Test
    void profileByMobile_ownProfile_isAlwaysReadable() throws Exception {
        User tenant = user("9822200024", "buyer");
        mvc.perform(put(Routes.Tenancies.MY_PROFILE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Asha K\"}"))
                .andExpect(status().isOk());

        mvc.perform(get("/tenant-profiles/" + tenant.getMobile())
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Asha K"))
                .andExpect(jsonPath("$.mobile").value(tenant.getMobile()));
    }

    // ---- 6: there is deliberately no create route (spec fix S9) ----

    @Test
    void thereIsNoWayForAClientToCreateATenancy() {
        Set<String> mapped = handlerMapping.getHandlerMethods().entrySet().stream()
                .filter(e -> e.getKey().getPathPatternsCondition() != null)
                .flatMap(e -> e.getKey().getPathPatternsCondition().getPatternValues().stream()
                        .map(path -> e.getKey().getMethodsCondition().getMethods().stream()
                                .map(Enum::name).collect(Collectors.joining(",")) + " " + path))
                .collect(Collectors.toSet());

        // A forged tenancy is a claim on somebody's rent — tenancies parents rent_payments and
        // rent_mandates — so the route must not exist at all, not merely be guarded.
        assertThat(mapped).doesNotContain("POST " + Routes.Tenancies.OWNED);
    }

    // ---- 7: route-constant ↔ handler-mapping agreement ----

    @Test
    void everyTenancyRouteConstantIsServedByAController() {
        Set<String> mapped = handlerMapping.getHandlerMethods().keySet().stream()
                .filter(info -> info.getPathPatternsCondition() != null)
                .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream())
                .collect(Collectors.toSet());

        assertThat(mapped).contains(
                Routes.Tenancies.MINE,
                Routes.Tenancies.OWNED,
                Routes.Tenancies.MY_PROFILE,
                Routes.Tenancies.PROFILE_BY_MOBILE);
    }
}
