package com.punenest.api.billing;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.billing.referral.ReferralRepository;
import com.punenest.api.billing.referral.ReferralStatuses;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.JwtService;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Contract + behaviour proof for the referral scheme and its fraud desk (slice 13).
 *
 * <p>A referral scheme is an endpoint that pays strangers, so the properties proved here are the
 * ones an attacker would go after:
 *
 * <ol>
 *   <li><strong>Redeeming grants nothing.</strong> It creates a {@code pending} row worth nothing;
 *       the grant arrives either when the referee's first listing verifies (Q17, proved in
 *       {@code ReferralQualificationTest}) or when a staff decision approves it. What redemption
 *       alone can mint is zero, and that is what {@code contactsEarned} says here.</li>
 *   <li><strong>Every refusal is identical.</strong> An unknown code, your own code and a mobile
 *       already referred all answer the same 409 with the same message, so the endpoint cannot be
 *       used to discover which codes are real.</li>
 *   <li><strong>The desk is staff-only.</strong> A plain user gets 403 on all four ops routes.</li>
 *   <li><strong>Mobiles are masked.</strong> There is no audited reveal path on this resource, so
 *       nothing on it may return a full number.</li>
 * </ol>
 */
class ReferralEndpointsTest extends AbstractApiTest {

    /**
     * {@code fees.referralContactBonus} in the seeded settings row — owner contacts, not rupees.
     *
     * <p>Was 500 and meant ₹500 until D31b. The rupees were never spendable anywhere in the product
     * while every screen promised contacts, so the reward now is what it always claimed to be.
     */
    private static final int REWARD = 15;

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired ReferralRepository referrals;

    // ---- fixtures ----

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Referral User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /**
     * A referee carrying the Aadhaar badge, which {@code approve} requires.
     *
     * <p>Applied <em>after</em> the referral row exists in some tests, on purpose: the check reads
     * the user's badge now, not the {@code aadhaar_verified} snapshot the referral froze at redeem
     * time. Redeem-then-verify is the ordinary order of events for a real referee.
     */
    private User aadhaarVerified(User u) {
        u.setAadhaarVerified(true);
        return users.saveAndFlush(u);
    }

    private static String jsonField(String body, String field) {
        int i = body.indexOf("\"" + field + "\":\"") + field.length() + 4;
        return body.substring(i, body.indexOf('"', i));
    }

    /**
     * The caller's own code, as the share screen would read it.
     *
     * <p>Minted from a fixed, non-loopback address because V64 stamps the referrer's D55 correlation
     * digests here. MockMvc gives every request the same remote address, so without this the whole
     * fixture would model referrer and referee sitting on one network — and every referral in this
     * class would come back flagged for correlation. The ordinary referral is between two people in
     * two places, and that is what these tests are about; the correlated case is proved on purpose
     * in {@code ReferralQualificationTest}.
     */
    private String codeOf(User u) throws Exception {
        return jsonField(mvc.perform(get(Routes.Referrals.MINE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .with(request -> {
                            request.setRemoteAddr("198.51.100.9");
                            return request;
                        }))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(), "code");
    }

    private void redeem(User caller, String code, int expectedStatus) throws Exception {
        mvc.perform(post(Routes.Referrals.REDEEM)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + code + "\"}"))
                .andExpect(status().is(expectedStatus));
    }

    /** One redeemed referral, returning the referrer and the referral's id. */
    private String referralFrom(User referrer, User referred) throws Exception {
        redeem(referred, codeOf(referrer), 200);
        return referrals.findByReferrerId(referrer.getId()).getFirst().getId().toString();
    }

    // ---- 1: the code ----

    @Test
    void theCodeIsMintedOnceAndNeverChanges() throws Exception {
        User u = user("9866600001", "owner");

        String first = codeOf(u);
        assertThat(first).startsWith("PUNE-").hasSize(9);
        // Deliberately excluded from the alphabet: these are the characters people misread aloud.
        assertThat(first.substring(5)).doesNotContainAnyWhitespaces()
                .matches("[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}");
        assertThat(codeOf(u)).isEqualTo(first);
    }

    @Test
    void anUntouchedSchemeReportsNothingEarnedAndNothingPending() throws Exception {
        User u = user("9866600002", "owner");
        mvc.perform(get(Routes.Referrals.MINE).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.invited").value(0))
                .andExpect(jsonPath("$.converted").value(0))
                .andExpect(jsonPath("$.contactsEarned").value(0))
                .andExpect(jsonPath("$.contactsPending").value(0));
    }

    // ---- 2: redeeming ----

    @Test
    void redeemingCountsAsInvitedAndPendingButNotYetEarned() throws Exception {
        User referrer = user("9866600010", "owner");
        User referred = user("9866600011", "buyer");

        redeem(referred, codeOf(referrer), 200);

        mvc.perform(get(Routes.Referrals.MINE).header(HttpHeaders.AUTHORIZATION, bearer(referrer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.invited").value(1))
                .andExpect(jsonPath("$.converted").value(0))
                .andExpect(jsonPath("$.contactsEarned").value(0))
                .andExpect(jsonPath("$.contactsPending").value(REWARD));
    }

    @Test
    void everyRefusalLooksTheSame() throws Exception {
        User referrer = user("9866600020", "owner");
        User referred = user("9866600021", "buyer");
        String code = codeOf(referrer);

        // A code nobody holds.
        redeem(referred, "PUNE-ZZZZ", 409);
        // Your own.
        redeem(referrer, code, 409);
        // A mobile that has already been referred.
        redeem(referred, code, 200);
        redeem(referred, code, 409);

        assertThat(referrals.findByReferrerId(referrer.getId())).hasSize(1);
    }

    @Test
    void redeemingRequiresACaller() throws Exception {
        mvc.perform(post(Routes.Referrals.REDEEM)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"PUNE-ABCD\"}"))
                .andExpect(status().isUnauthorized());
    }

    // ---- 3: the fraud desk ----

    @Test
    void theQueueAndItsDecisionsAreStaffOnly() throws Exception {
        User referrer = user("9866600030", "owner");
        User referred = user("9866600031", "buyer");
        String id = referralFrom(referrer, referred);
        String plain = bearer(referred);

        mvc.perform(get(Routes.Referrals.BASE).header(HttpHeaders.AUTHORIZATION, plain))
                .andExpect(status().isForbidden());
        mvc.perform(post("/referrals/" + id + "/approve").header(HttpHeaders.AUTHORIZATION, plain))
                .andExpect(status().isForbidden());
        mvc.perform(post("/referrals/" + id + "/reject").header(HttpHeaders.AUTHORIZATION, plain))
                .andExpect(status().isForbidden());
        mvc.perform(post("/referrals/" + id + "/clawback").header(HttpHeaders.AUTHORIZATION, plain))
                .andExpect(status().isForbidden());
    }

    @Test
    void theQueueIsPagedAndMasksBothMobiles() throws Exception {
        User referrer = user("9866600040", "owner");
        User referred = user("9866600041", "buyer");
        User staff = user("9866600042", "staff");
        referralFrom(referrer, referred);

        mvc.perform(get(Routes.Referrals.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .param("status", ReferralStatuses.PENDING))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").exists())
                .andExpect(jsonPath("$.content[0].status").value(ReferralStatuses.PENDING))
                .andExpect(jsonPath("$.content[0].rewardAmount").value(REWARD))
                .andExpect(jsonPath("$.content[0].referrerMobile",
                        Matchers.not(Matchers.containsString(referrer.getMobile()))))
                .andExpect(jsonPath("$.content[0].referredMobile",
                        Matchers.not(Matchers.containsString(referred.getMobile()))))
                // Computed since V64 (D55), and false here because the fixture redeems from a
                // different address than the code was minted from -- see codeOf. False means "no
                // correlation found", which is what the desk should see for an ordinary referral.
                .andExpect(jsonPath("$.content[0].sameDevice").value(false))
                .andExpect(jsonPath("$.content[0].sameIp").value(false));
    }

    @Test
    void approvingReleasesTheRewardAndCannotBeDoneTwice() throws Exception {
        User referrer = user("9866600050", "owner");
        User referred = user("9866600051", "buyer");
        User staff = user("9866600052", "staff");
        String id = referralFrom(referrer, referred);
        aadhaarVerified(referred);

        mvc.perform(post("/referrals/" + id + "/approve")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ReferralStatuses.REWARDED))
                .andExpect(jsonPath("$.handledAt").value(Matchers.notNullValue()));

        mvc.perform(get(Routes.Referrals.MINE).header(HttpHeaders.AUTHORIZATION, bearer(referrer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.converted").value(1))
                .andExpect(jsonPath("$.contactsEarned").value(REWARD))
                .andExpect(jsonPath("$.contactsPending").value(0));

        mvc.perform(post("/referrals/" + id + "/approve")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isConflict());
    }

    /**
     * The scheme's one anti-fraud rule, which lived in the browser until wave 2c.
     *
     * <p>{@code OpsReferrals} greyed out its Approve button under a banner calling the check
     * mandatory, while this endpoint released the money to anyone who called it directly. The
     * refusal carries its own sentence rather than the transition one: {@code pending} is exactly
     * the state approve works from, so "cannot be rewarded" would send a desk hunting a status bug
     * that does not exist.
     */
    @Test
    void anUnverifiedRefereeCannotBeApprovedUntilTheBadgeArrives() throws Exception {
        User referrer = user("9866600055", "owner");
        User referred = user("9866600056", "buyer");
        User staff = user("9866600057", "staff");
        String id = referralFrom(referrer, referred);
        String auth = bearer(staff);

        mvc.perform(post("/referrals/" + id + "/approve").header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message",
                        Matchers.containsString("not Aadhaar-verified")));

        // Rejecting is still available: a desk must always be able to close a referral it will
        // never pay, and refusing that would leave the queue with rows nobody can act on.
        // Verifying afterwards is the ordinary order of events, and it unblocks the reward - the
        // check reads the badge now, not the snapshot the referral froze at redeem time.
        aadhaarVerified(referred);

        mvc.perform(post("/referrals/" + id + "/approve").header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ReferralStatuses.REWARDED));
    }

    @Test
    void rejectingRefusesTheRewardAndKeepsTheReason() throws Exception {
        User referrer = user("9866600060", "owner");
        User referred = user("9866600061", "buyer");
        User staff = user("9866600062", "staff");
        String id = referralFrom(referrer, referred);

        mvc.perform(post("/referrals/" + id + "/reject")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Same household\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ReferralStatuses.REJECTED));

        mvc.perform(get(Routes.Referrals.MINE).header(HttpHeaders.AUTHORIZATION, bearer(referrer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contactsEarned").value(0))
                .andExpect(jsonPath("$.contactsPending").value(0));
    }

    @Test
    void onlyAReleasedRewardCanBeClawedBack() throws Exception {
        User referrer = user("9866600070", "owner");
        User referred = user("9866600071", "buyer");
        User staff = user("9866600072", "staff");
        String id = referralFrom(referrer, referred);
        aadhaarVerified(referred);
        String auth = bearer(staff);

        // Nothing was ever paid, so there is nothing to recover.
        mvc.perform(post("/referrals/" + id + "/clawback")
                        .header(HttpHeaders.AUTHORIZATION, auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Fraud ring\"}"))
                .andExpect(status().isConflict());

        mvc.perform(post("/referrals/" + id + "/approve").header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isOk());

        mvc.perform(post("/referrals/" + id + "/clawback")
                        .header(HttpHeaders.AUTHORIZATION, auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Fraud ring\"}"))
                .andExpect(status().isOk())
                // Distinct from `rejected` on purpose (spec fix S52): this one was paid and taken back.
                .andExpect(jsonPath("$.status").value(ReferralStatuses.CLAWED_BACK));

        mvc.perform(get(Routes.Referrals.MINE).header(HttpHeaders.AUTHORIZATION, bearer(referrer)))
                .andExpect(status().isOk())
                // The grant is derived from the row's status, so the clawback withdrew it with no
                // compensating write. A stored balance would still be sitting there (D31b).
                .andExpect(jsonPath("$.contactsEarned").value(0));
    }

    @Test
    void aReferralThatDoesNotExistIsNotFound() throws Exception {
        User staff = user("9866600080", "staff");
        mvc.perform(post("/referrals/" + java.util.UUID.randomUUID() + "/approve")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isNotFound());
        // A non-UUID path token is a 404 too, not a 400 — Ids.parseUuid returns empty.
        mvc.perform(post("/referrals/not-a-uuid/approve")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isNotFound());
    }
}
