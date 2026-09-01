package com.draazy.api.finance.tenancy;

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
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * {@code POST /tenant-profiles/verified} — the batch badge (tech-debt D114).
 *
 * <p><strong>The load-bearing tests here are the ones that stop this becoming an identity
 * oracle.</strong> The endpoint takes arbitrary mobile numbers from any authenticated caller, so
 * the only thing separating it from a tool for walking the ten-digit space is that every refusal
 * looks identical: an unregistered number, a registered one with no badge, and a verified stranger
 * the caller has no relationship with must all answer plain {@code false}, in a body that carries
 * no reason and no profile field. Those three cases are asserted together, in one response, on
 * purpose — asserting them in separate tests would let the shapes drift apart without failing.
 *
 * <p>The other rule with teeth: the answer must be exactly as wide as
 * {@link TenantProfileService#getByMobile}'s and no wider. {@link #batchAgreesWithTheSingleRead}
 * pins the two together, so a future relaxation of the batch guard fails here rather than shipping
 * as a quiet privilege escalation with a green suite.
 */
@DisplayName("The batch verified-tenant badge — one bit per row, and never a fourth answer")
class TenantVerifiedBatchTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired TenantProfileRepository profiles;

    // ---- helpers ----

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

    /** Opens a tenancy the only way the platform allows — by closing a rent deal (D1/S9). */
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

    /**
     * Award the badge the only way a test can.
     *
     * <p>{@code verified} is server-owned: {@link TenantProfileService#updateMine} copies it from
     * the Aadhaar record, which is written by a DigiLocker webhook no test can fire (the same
     * carve-out the verification seam documents). The batch reads the stored column, so setting
     * that column <em>is</em> the precondition under test — going through the webhook would be
     * testing the webhook.
     *
     * <p>Through the repository rather than raw SQL on purpose: the profile was written moments ago
     * by a request sharing this test's transaction, so it may still be an unflushed insert. An
     * {@code UPDATE} issued behind Hibernate's back would match no row and quietly award nothing.
     */
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

    // ---- 1: the badge a related caller is entitled to ----

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

    // ---- 2: the four ways of being told nothing are one answer ----

    /**
     * The whole security argument for this endpoint, in one response.
     *
     * <p>A caller with one real relationship asks about their own tenant, a verified stranger, an
     * unverified stranger they <em>are</em> related to, a number nobody has registered, and a
     * string that is not a mobile at all. Only the first answers {@code true}. If any of the other
     * four ever answered differently from the rest, this endpoint would confirm which of the ten
     * billion Indian mobile numbers are registered — keyed by the exact identifier the contact gate
     * exists to protect.
     */
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
                                myTenant.getMobile(),        // related + verified
                                verifiedStranger.getMobile(), // verified, but not the caller's business
                                unverifiedTenant.getMobile(), // related, no badge
                                "9876500099",                 // registered to nobody
                                "not-a-mobile")))             // not a number at all
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(5))
                .andExpect(jsonPath("$[0].verified").value(true))
                .andExpect(jsonPath("$[1].verified").value(false))
                .andExpect(jsonPath("$[2].verified").value(false))
                .andExpect(jsonPath("$[3].verified").value(false))
                .andExpect(jsonPath("$[4].verified").value(false));
    }

    // ---- 3: a badge is one bit, and the bit is all that crosses the wire ----

    /**
     * A row carries {@code mobile} and {@code verified} and nothing else.
     *
     * <p>The obvious implementation of a batch badge is a list of {@code TenantProfile}s, and it is
     * wrong: that read hands a related caller a name, an occupation and a monthly income, so
     * batching it would move a whole list's worth of somebody's income across the wire to draw a
     * tick. The field count is asserted rather than a handful of {@code doesNotExist} checks so
     * that a field added later — for any reason, by anybody — fails here.
     */
    @Test
    void aRowCarriesTheFlagAndTheCallersOwnInputAndNothingElse() throws Exception {
        User owner = user("9822300007", "owner");
        User tenant = user("9822300008", "buyer");
        saveProfile(tenant, "Asha K");
        awardBadge(tenant);
        closeRentDeal(owner, rentListing(owner), tenant);

        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batchOf(tenant.getMobile())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].*", Matchers.hasSize(2)))
                .andExpect(jsonPath("$[0].name").doesNotExist())
                .andExpect(jsonPath("$[0].income").doesNotExist())
                .andExpect(jsonPath("$[0].score").doesNotExist())
                .andExpect(jsonPath("$[0].occupation").doesNotExist())
                .andExpect(jsonPath("$[0].reason").doesNotExist());
    }

    /**
     * The echo is verbatim — the caller's string, not the normalised one, not the stored one.
     *
     * <p>That is what makes the standing rule safe here (D5/Q2: an owner's raw mobile is never
     * revealed to a buyer pre-deal). This endpoint takes numbers in, so the question is whether it
     * can be made to hand one <em>out</em>; it cannot, because the only numbers it emits are the
     * ones it was handed. A response that returned the normalised or stored form would be
     * returning a value the server chose, and the argument would have to be made again every time
     * the shape changed.
     */
    @Test
    void theMobileFieldIsTheCallersOwnStringUnchanged() throws Exception {
        User owner = user("9822300009", "owner");
        User tenant = user("9822300010", "buyer");
        saveProfile(tenant, "Asha K");
        awardBadge(tenant);
        closeRentDeal(owner, rentListing(owner), tenant);

        // Typed the way a person types it: country code and spacing. The lookup normalises; the
        // answer does not.
        String asTyped = "+91 " + tenant.getMobile().substring(0, 5) + " "
                + tenant.getMobile().substring(5);

        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batchOf(asTyped)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].mobile").value(asTyped))
                .andExpect(jsonPath("$[0].verified").value(true));
    }

    // ---- 4: the batch is bounded ----

    /**
     * An unbounded list is an amplification primitive — one small request buying an arbitrary
     * amount of database work — so the cap is a refusal rather than a silent truncation. Both edges
     * are asserted: a batch that is silently trimmed to fifty would pass a test that only checked
     * the 400.
     */
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

    // ---- 5: shape ----

    /**
     * Same length, same order, repeats repeated. The client zips this against its own rows, so a
     * response that deduplicated or reordered would silently move badges onto the wrong people —
     * the one failure mode of a badge that is worse than not showing it.
     */
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
        // 422, not 400: a body that parses but fails @Valid is the platform's validation shape
        // (GlobalExceptionHandler.handleBodyValidation returns a ValidationProblem), and this
        // endpoint must not invent a status of its own. The distinction that matters to the caller
        // is the one asserted above -- an explicitly empty list is a legitimate question with an
        // empty answer, whereas an absent list is a malformed request.
        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void anAnonymousCallerIsRefusedJustAsOnTheSingleRead() throws Exception {
        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batchOf("9876500099")))
                .andExpect(status().isUnauthorized());
    }

    // ---- 6: the batch may never be wider than the single read ----

    /**
     * The invariant that must not be allowed to rot: {@code true} here exactly where the single
     * read succeeds, {@code false} exactly where it 404s.
     *
     * <p>Both answers are checked against the same pair of people in the same test, so relaxing the
     * batch's relationship guard — the tempting optimisation, since the guard costs two queries per
     * distinct person — fails here rather than shipping as a privilege escalation nobody notices.
     * A batch endpoint that answered a question its per-item twin refuses is not a convenience, it
     * is a bypass.
     */
    @Test
    void batchAgreesWithTheSingleRead() throws Exception {
        User owner = user("9822300016", "owner");
        User tenant = user("9822300017", "buyer");
        User stranger = user("9822300018", "buyer");
        saveProfile(tenant, "Asha K");
        awardBadge(tenant);
        saveProfile(stranger, "Dev P");
        awardBadge(stranger);
        closeRentDeal(owner, rentListing(owner), tenant);

        // The single read: 200 for the tenant, 404 for the stranger.
        mvc.perform(get("/tenant-profiles/" + tenant.getMobile())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true));
        mvc.perform(get("/tenant-profiles/" + stranger.getMobile())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNotFound());

        // The batch, same caller, same two people, same verdicts.
        mvc.perform(post(Routes.Tenancies.PROFILES_VERIFIED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batchOf(tenant.getMobile(), stranger.getMobile())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].verified").value(true))
                .andExpect(jsonPath("$[1].verified").value(false));
    }

    /** A tenant asking about themselves is the one caller who never needs a relationship. */
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
