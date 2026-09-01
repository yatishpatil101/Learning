package com.draazy.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The concierge desk and the freemium listing ceiling — why the desk is exempt, and what it is told
 * instead.
 *
 * <p><strong>The defect this was written for.</strong> {@code POST /admin/properties} creates a
 * listing owned by whoever the operator names, and it did so through the same
 * {@code ListingService.create} the owner's own wizard calls — so it inherited the owner's plan
 * ceiling. An operator on the phone with somebody who owns three flats could record one of them and
 * was refused the other two, with a 422 whose message is written for an owner sitting in the
 * wizard: "You already have 1 of 1 listings live. Take one down, upgrade your plan, or refer an
 * owner to earn another slot." Shown to a member of staff, about somebody else's account, offering
 * them remedies they cannot perform.
 *
 * <p>Worse, it was unconditional in practice rather than occasional. Every owner this route
 * provisions is brand new and therefore on the free tier, so the desk could never record a second
 * listing for any caller it had not previously seen — and the wizard's own duplicate safeguard
 * ("this owner already has N pending listings", the thing that stops a second operator taking the
 * same flat down twice) was unreachable for exactly the same reason.
 *
 * <p><strong>Why exemption is the right shape.</strong> The ceiling is a rule about self-service.
 * This route is staff-only behind its own {@code postOnBehalf:write} atom, writes two audit rows,
 * and has a person deciding. What it produces is a {@code pending} listing in a hand-back funnel
 * the owner has not accepted yet — the owner gains nothing they could have helped themselves to.
 *
 * <p><strong>What replaces the refusal.</strong> Not silence.
 * {@code GET /admin/properties/owner-standing} publishes the two numbers the gate would have
 * refused on, so the operator can see they are holding an upgrade conversation. Counts only, never
 * a plan name or a price: the operator needs to know there is a conversation, not what the account
 * is worth.
 */
@DisplayName("D239 — the concierge desk could only ever record one listing per owner")
class ConciergeListingQuotaTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    /**
     * Undo what the rollback cannot reach.
     *
     * <p>Two of this class's writes commit outside the test transaction: the desk's audit rows go
     * through {@code REQUIRES_NEW}, and so does the provisioning of an owner who has never signed in
     * — which is the point of that route, since "we opened an account for this number" must survive
     * whatever happens to the listing afterwards. Both therefore outlive the class and are still in
     * {@code draazy_test} when the next one runs, and a leftover account is not inert: it holds a
     * unique mobile. The first draft borrowed a block {@code OwnerOutreachTest} already owned, and
     * the next full suite failed on a unique-constraint violation reported against <em>that</em>
     * class, which had changed nothing.
     *
     * <p>{@code @AfterAll}, not {@code @AfterEach}, because the listing rows referencing these
     * accounts are still uncommitted while a test is in flight — deleting the owner there answers
     * with a foreign-key violation rather than a clean-up. After the class, the rollback has already
     * taken the listings and only the committed accounts are left.
     */
    @AfterAll
    static void removeRowsThatEscapedRollback() {
        cleanup.update("delete from audit_log where action like '%_on_behalf'");
        cleanup.update("delete from users where mobile like '98539000%'");
    }

    /** {@code @AfterAll} is static and cannot be injected; the instance template is borrowed here. */
    private static JdbcTemplate cleanup;

    @BeforeEach
    void lendTemplateToTheStaticTeardown() {
        cleanup = jdbc;
    }

    private static final String ON_BEHALF = """
            {"ownerMobile":"%s","ownerName":"Phoned In",
             "listing":{"title":"%s","deal":"rent","propertyType":"apartment","price":25000,
                        "locality":"Kothrud","city":"Pune"}}
            """;

    /**
     * An account, saved directly.
     *
     * <p>Mobiles come from the <b>98539 000xx</b> block, which no other test class uses. That
     * matters here in a way it does not in a rolled-back test: the desk's writes commit, so the
     * accounts these tests create outlive the class and are still in {@code draazy_test} when the
     * next class runs. The first draft borrowed 98530 000xx, which {@code OwnerOutreachTest} already
     * owns, and the two passed in isolation and failed the full suite on a unique-constraint
     * violation — reported against the *other* class, which had changed nothing.
     */
    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Concierge " + mobile);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /**
     * A listing already in the catalogue, saved directly rather than posted.
     *
     * <p>The same reasoning as {@code ListingQuotaTest}: the count these tests are about comes from
     * the catalogue, not from a session, so the fixture must arrive by a route no caller was part of.
     */
    private Property held(User owner, String title, String status) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        p.setStatus(status);
        p.setLocalitySlug("kothrud");
        return properties.saveAndFlush(p);
    }

    private int postOnBehalf(User staff, String ownerMobile, String title) throws Exception {
        return mvc.perform(post("/admin/properties")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ON_BEHALF.formatted(ownerMobile, title)))
                .andReturn().getResponse().getStatus();
    }

    @Test
    @DisplayName("the desk can record a second listing for an owner whose own wizard would refuse")
    void theDeskIsNotBoundByTheOwnersPlan() throws Exception {
        User staff = user("9853900001", "staff");
        User owner = user("9853900002", "owner");
        held(owner, "The flat they already listed", PropertyStatus.APPROVED);

        assertThat(postOnBehalf(staff, owner.getMobile(), "The second flat they phoned in"))
                .isEqualTo(201);
    }

    /**
     * The case that made the exemption unavoidable rather than merely nicer. A caller the platform
     * has never seen is provisioned onto the free tier by the first post, so without the exemption
     * the second one is refused — meaning the desk could record exactly one listing per new caller,
     * forever.
     */
    @Test
    @DisplayName("a brand-new owner does not run out after one, which is every first call")
    void aProvisionedOwnerIsNotCappedAtOne() throws Exception {
        User staff = user("9853900003", "staff");

        assertThat(postOnBehalf(staff, "9853900004", "Their first flat")).isEqualTo(201);
        assertThat(postOnBehalf(staff, "9853900004", "Their second flat")).isEqualTo(201);
        assertThat(postOnBehalf(staff, "9853900004", "Their third flat")).isEqualTo(201);
    }

    /**
     * The exemption is a property of the route, not of the owner. Nothing the desk does may make an
     * owner's own wizard more permissive — otherwise "ring the office" becomes the documented way
     * around the paywall.
     */
    @Test
    @DisplayName("the exemption does not follow the owner back to their own wizard")
    void theOwnersOwnPostIsStillRefused() throws Exception {
        User staff = user("9853900005", "staff");
        User owner = user("9853900006", "owner");

        assertThat(postOnBehalf(staff, owner.getMobile(), "Phoned in")).isEqualTo(201);

        mvc.perform(post("/me/listings")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Typed in myself","deal":"rent","propertyType":"apartment",
                                 "price":25000,"locality":"Kothrud","city":"Pune"}
                                """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error").value("listing_quota_exhausted"));
    }

    @Test
    @DisplayName("the standing read names both numbers, and says when one is past the other")
    void standingReportsTheOverage() throws Exception {
        User staff = user("9853900007", "staff");
        User owner = user("9853900008", "owner");
        held(owner, "One", PropertyStatus.APPROVED);
        held(owner, "Two", PropertyStatus.PENDING);

        mvc.perform(get("/admin/properties/owner-standing")
                        .param("mobile", owner.getMobile())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.known").value(true))
                .andExpect(jsonPath("$.allowance").value(1))
                .andExpect(jsonPath("$.held").value(2))
                .andExpect(jsonPath("$.overAllowance").value(true));
    }

    /**
     * An owner sitting exactly on their ceiling is not over it. The distinction matters because this
     * is the state the desk sees most often — one free listing, already used — and an operator who
     * is warned about every caller stops reading the warning.
     */
    @Test
    @DisplayName("at the ceiling is not over it")
    void standingDoesNotCryWolfAtExactlyTheLimit() throws Exception {
        User staff = user("9853900009", "staff");
        User owner = user("9853900010", "owner");
        held(owner, "Their only one", PropertyStatus.APPROVED);

        mvc.perform(get("/admin/properties/owner-standing")
                        .param("mobile", owner.getMobile())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.held").value(1))
                .andExpect(jsonPath("$.overAllowance").value(false));
    }

    /**
     * "No account yet" is the ordinary answer on a first call, so it is a 200. A 404 would make the
     * console render its error state for the commonest thing that happens at this desk.
     */
    @Test
    @DisplayName("a number with no account answers 200, not 404")
    void anUnknownNumberIsNotAnError() throws Exception {
        User staff = user("9853900011", "staff");

        mvc.perform(get("/admin/properties/owner-standing")
                        .param("mobile", "9853900012")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.known").value(false))
                .andExpect(jsonPath("$.held").value(0))
                .andExpect(jsonPath("$.overAllowance").value(false));
    }

    /**
     * Separators, not a country code. {@code Mobile} is ten digits everywhere on this platform, and
     * a route that quietly accepted {@code +91} would be the only one that did — the desk's own
     * {@code POST} would still refuse the same string a moment later.
     */
    @Test
    @DisplayName("the number is normalised the way an operator types it")
    void spacingAndPunctuationAreStripped() throws Exception {
        User staff = user("9853900013", "staff");
        User owner = user("9853900014", "owner");

        mvc.perform(get("/admin/properties/owner-standing")
                        .param("mobile", "98539 00014")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mobile").value(owner.getMobile()))
                .andExpect(jsonPath("$.known").value(true));
    }

    @Test
    @DisplayName("a half-typed number is a 400, not a lookup for nobody")
    void anIncompleteNumberIsRefused() throws Exception {
        User staff = user("9853900015", "staff");

        mvc.perform(get("/admin/properties/owner-standing")
                        .param("mobile", "98530")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isBadRequest());
    }

    /**
     * The standing read discloses one named person's plan position, so it is guarded by the desk's
     * own atom rather than by {@code properties:read}. A buyer must not reach it at all.
     */
    @Test
    @DisplayName("a buyer cannot read anybody's standing")
    void standingIsStaffOnly() throws Exception {
        User buyer = user("9853900016", "buyer");

        mvc.perform(get("/admin/properties/owner-standing")
                        .param("mobile", "9853900017")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isForbidden());
    }
}
