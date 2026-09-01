package com.punenest.api.billing.plan;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The owner-contact quota is the server's to enforce, and the referral scheme's reward is contacts
 * (D31b).
 *
 * <p><strong>What this replaced.</strong> Until this slice the free tier's fifteen contacts were
 * counted in {@code localStorage}, under a key derived from the user's own mobile number, by a
 * module whose header comment said in as many words that it was not real security. Clearing site
 * data reset it. So did opening a second browser. The referral bonus that topped it up was computed
 * the same way, which meant the platform's referral scheme paid out an entitlement the platform had
 * never granted and could never withdraw.
 *
 * <p>The properties proved here are the ones that make the gate worth having:
 *
 * <ol>
 *   <li><strong>Nothing is stored.</strong> The allowance is derived from the caller's live plan and
 *       their qualified referrals on every call, so a clawback withdraws contacts with no
 *       compensating write — {@link #clawingBackAReferralWithdrawsTheContactsItGranted}.</li>
 *   <li><strong>Only a new owner costs a contact.</strong> Re-reading a request already open, and
 *       looking at your own listing, are free even after the allowance is gone. Idempotency and the
 *       quota have to coexist, and this is where that is settled.</li>
 *   <li><strong>The refusal is 422.</strong> Not 403, which invites a client to offer a login that
 *       cannot help, and not 429, which promises that waiting will.</li>
 *   <li><strong>A priced plan lifts the ceiling</strong> and reports it as {@code null} rather than
 *       as a very large number nobody can read.</li>
 * </ol>
 *
 * <p>Lives in {@code billing.plan} so it can build a {@link Subscription} through the
 * package-private constructor, for the same reason {@code SubscriptionLifecycleTest} does: going
 * through the checkout and its payment gateway to prove something about entitlement would test the
 * gateway.
 */
@DisplayName("Entitlements — the contact quota the browser used to keep")
class EntitlementsEndpointsTest extends AbstractApiTest {

    /** Owner Plus. Priced, and {@code unlimited_contacts} since V91. */
    private static final String UNLIMITED_PLAN = "b1000000-0000-4000-8000-000000000002";

    /** {@code fees.freeContactLimit} and {@code fees.referralContactBonus} in the seeded row. */
    private static final int FREE_LIMIT = 15;
    private static final int REFERRAL_BONUS = 15;

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired SubscriptionRepository subscriptions;

    // ---- fixtures ----

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Entitled " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private User aadhaarVerified(String mobile, String role) {
        User u = user(mobile, role);
        u.setAadhaarVerified(true);
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

    /** Put {@code buyer} in front of one owner, and say what the server made of it. */
    private int ask(User buyer, Property p) throws Exception {
        return mvc.perform(post(Routes.Contacts.REQUEST)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\"}"))
                .andReturn().getResponse().getStatus();
    }

    /** Spend {@code count} contacts against {@code count} different owners. */
    private void spend(User buyer, int count, long firstOwnerMobile) throws Exception {
        for (int i = 0; i < count; i++) {
            User owner = user(String.valueOf(firstOwnerMobile + i), "owner");
            assertThat(ask(buyer, listing(owner, "Flat " + i))).isEqualTo(200);
        }
    }

    private void unlimitedPlan(User u) {
        subscriptions.saveAndFlush(new Subscription(u.getId(), UUID.fromString(UNLIMITED_PLAN),
                SubscriptionStatuses.ACTIVE, Instant.now(),
                Instant.now().plus(30, ChronoUnit.DAYS), null, null));
    }

    /**
     * Earn one qualified referral for {@code referrer}, through the real endpoints.
     *
     * <p>Driven through redeem-then-approve rather than by inserting a {@code qualified} row,
     * because the point of the derivation is that it reads whatever the referral desk actually
     * wrote. A fixture that sets the status directly would still pass if the desk stopped setting
     * it.
     */
    private String referralApprovedFor(User referrer, String refereeMobile, User staff)
            throws Exception {
        User referee = aadhaarVerified(refereeMobile, "buyer");
        String code = mvc.perform(get(Routes.Referrals.MINE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(referrer)))
                .andReturn().getResponse().getContentAsString()
                .replaceAll("^.*?\"code\":\"([^\"]+)\".*$", "$1");

        mvc.perform(post(Routes.Referrals.REDEEM)
                        .header(HttpHeaders.AUTHORIZATION, bearer(referee))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + code + "\"}"))
                .andExpect(status().isOk());

        String id = mvc.perform(get(Routes.Referrals.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andReturn().getResponse().getContentAsString()
                .replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");

        mvc.perform(post(Routes.Referrals.BASE + "/" + id + "/approve")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk());
        return id;
    }

    // ---- 1: what the free tier is worth ----

    @Test
    @DisplayName("a brand-new account is told the free allowance, not left to assume one")
    void freeTierReportsItsAllowance() throws Exception {
        User u = user("9844400001", "buyer");

        mvc.perform(get(Routes.Plans.ENTITLEMENTS).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contacts.unlimited").value(false))
                .andExpect(jsonPath("$.contacts.used").value(0))
                .andExpect(jsonPath("$.contacts.allowance").value(FREE_LIMIT))
                .andExpect(jsonPath("$.contacts.remaining").value(FREE_LIMIT))
                .andExpect(jsonPath("$.contacts.referralBonus").value(0))
                // Owner Free's listing_limit. Reported even to a buyer, because the number is a
                // property of the account rather than of the role it is browsing under.
                .andExpect(jsonPath("$.listings.allowance").value(1))
                .andExpect(jsonPath("$.listings.referralBonus").value(0));
    }

    @Test
    @DisplayName("the count is contact_requests itself — no tally to drift")
    void openingAContactSpendsExactlyOne() throws Exception {
        User buyer = user("9844400010", "buyer");
        spend(buyer, 2, 9844400011L);

        mvc.perform(get(Routes.Plans.ENTITLEMENTS).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.contacts.used").value(2))
                .andExpect(jsonPath("$.contacts.remaining").value(FREE_LIMIT - 2));
    }

    @Test
    @DisplayName("asking the same owner twice costs one contact, not two")
    void reReadingAnOpenRequestIsFree() throws Exception {
        User buyer = user("9844400020", "buyer");
        Property p = listing(user("9844400021", "owner"), "Repeat flat");

        assertThat(ask(buyer, p)).isEqualTo(200);
        assertThat(ask(buyer, p)).isEqualTo(200);

        mvc.perform(get(Routes.Plans.ENTITLEMENTS).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.contacts.used").value(1));
    }

    @Test
    @DisplayName("an owner opening their own listing spends nothing — the check runs after that branch")
    void anOwnerNeverSpendsOnTheirOwnListing() throws Exception {
        User owner = user("9844400030", "owner");

        assertThat(ask(owner, listing(owner, "My own flat"))).isEqualTo(200);

        mvc.perform(get(Routes.Plans.ENTITLEMENTS).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.contacts.used").value(0));
    }

    // ---- 2: running out ----

    @Test
    @DisplayName("the sixteenth new owner is refused with 422, not 403 and not 429")
    void exhaustingTheQuotaRefusesTheNextNewOwner() throws Exception {
        User buyer = user("9844401000", "buyer");
        spend(buyer, FREE_LIMIT, 9844401001L);

        mvc.perform(get(Routes.Plans.ENTITLEMENTS).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.contacts.remaining").value(0));

        Property oneTooMany = listing(user("9844401099", "owner"), "One too many");
        mvc.perform(post(Routes.Contacts.REQUEST)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + oneTooMany.getId() + "\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error").value("contact_quota_exhausted"));
    }

    /**
     * The property that makes the quota liveable rather than punitive.
     *
     * <p>Running out means you cannot approach a <em>new</em> owner. It must not mean the
     * conversations you already opened stop working — a buyer locked out of a request an owner has
     * already replied to would read as a broken product rather than a paywall, and it would break
     * the idempotency the contact gate depends on for double-taps.
     */
    @Test
    @DisplayName("an exhausted caller can still re-read the requests they already opened")
    void exhaustionNeverClosesADoorAlreadyOpened() throws Exception {
        User buyer = user("9844402000", "buyer");
        User owner = user("9844402001", "owner");
        Property first = listing(owner, "Already asked");

        assertThat(ask(buyer, first)).isEqualTo(200);
        spend(buyer, FREE_LIMIT - 1, 9844402010L);

        assertThat(ask(buyer, first)).isEqualTo(200);
        assertThat(ask(buyer, listing(user("9844402099", "owner"), "Blocked")))
                .isEqualTo(422);
    }

    // ---- 3: what a referral is worth ----

    @Test
    @DisplayName("a qualified referral raises the ceiling, and says how much of it it bought")
    void anApprovedReferralGrantsContacts() throws Exception {
        User referrer = user("9844403000", "owner");
        User staff = user("9844403009", "staff");
        referralApprovedFor(referrer, "9844403001", staff);

        mvc.perform(get(Routes.Plans.ENTITLEMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(referrer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contacts.allowance").value(FREE_LIMIT + REFERRAL_BONUS))
                .andExpect(jsonPath("$.contacts.remaining").value(FREE_LIMIT + REFERRAL_BONUS))
                .andExpect(jsonPath("$.contacts.referralBonus").value(REFERRAL_BONUS));

        // Three referrals buy one listing slot, so one buys none. Integer division on purpose:
        // part of a listing slot is not a thing.
        mvc.perform(get(Routes.Plans.ENTITLEMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(referrer)))
                .andExpect(jsonPath("$.listings.referralBonus").value(0));
    }

    @Test
    @DisplayName("clawing back withdraws the contacts, because nothing was ever stored")
    void clawingBackAReferralWithdrawsTheContactsItGranted() throws Exception {
        User referrer = user("9844404000", "owner");
        User staff = user("9844404009", "staff");
        String id = referralApprovedFor(referrer, "9844404001", staff);

        mvc.perform(post(Routes.Referrals.BASE + "/" + id + "/clawback")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Fraud ring\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Plans.ENTITLEMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(referrer)))
                .andExpect(jsonPath("$.contacts.allowance").value(FREE_LIMIT))
                .andExpect(jsonPath("$.contacts.referralBonus").value(0));
    }

    // ---- 4: what a priced plan is worth ----

    @Test
    @DisplayName("an unlimited plan reports null rather than a number nobody can read")
    void aPricedPlanLiftsTheCeiling() throws Exception {
        User u = user("9844405000", "owner");
        unlimitedPlan(u);
        spend(u, 1, 9844405001L);

        mvc.perform(get(Routes.Plans.ENTITLEMENTS).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contacts.unlimited").value(true))
                .andExpect(jsonPath("$.contacts.allowance").doesNotExist())
                .andExpect(jsonPath("$.contacts.remaining").doesNotExist())
                // Usage is still reported. The plan makes it moot, not uninteresting.
                .andExpect(jsonPath("$.contacts.used").value(1))
                .andExpect(jsonPath("$.listings.allowance").value(2));
    }

    /**
     * A pending order buys nothing, which is the whole reason this endpoint is not
     * {@code GET /me/subscription} with extra fields.
     *
     * <p>That endpoint deliberately reports a {@code pending} row so a first-time subscriber can
     * find and resume their unpaid order. Reading entitlement off the same answer would hand a
     * priced plan's contact allowance to anyone who opened a checkout and closed the tab.
     */
    @Test
    @DisplayName("an unpaid order confers nothing — capability is not the same question as standing")
    void aPendingSubscriptionEntitlesNothing() throws Exception {
        User u = user("9844406000", "owner");
        subscriptions.saveAndFlush(new Subscription(u.getId(), UUID.fromString(UNLIMITED_PLAN),
                SubscriptionStatuses.PENDING, Instant.now(), null, null, null));

        mvc.perform(get(Routes.Plans.ENTITLEMENTS).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contacts.unlimited").value(false))
                .andExpect(jsonPath("$.contacts.allowance").value(FREE_LIMIT))
                .andExpect(jsonPath("$.listings.allowance").value(1));
    }

    @Test
    @DisplayName("entitlements are the caller's own — there is no id on this route to tamper with")
    void theRouteIsAuthenticated() throws Exception {
        mvc.perform(get(Routes.Plans.ENTITLEMENTS))
                .andExpect(status().isUnauthorized());
    }
}
