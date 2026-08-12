package com.punenest.api.billing;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.billing.referral.Referral;
import com.punenest.api.billing.referral.ReferralQualification;
import com.punenest.api.billing.referral.ReferralRepository;
import com.punenest.api.billing.referral.ReferralSignalRetention;
import com.punenest.api.billing.referral.ReferralStatuses;
import com.punenest.api.billing.referral.ShareChannels;
import com.punenest.api.common.settings.PlatformSettings;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Q17's qualifying action, and the three signals that were declared and never produced
 * (D191, D56, D60, D55, D61).
 *
 * <p>The properties proved here are the ones a farmer would attack and the ones a privacy review
 * would ask about:
 *
 * <ol>
 *   <li><strong>A credit is minted by verification, not by joining.</strong> Redeeming still pays
 *       nothing; the referral moves to {@code qualified} only when the referee's listing clears the
 *       ownership gate.</li>
 *   <li><strong>First means first, and once means once.</strong> A second verified listing and a
 *       replayed announcement both mint nothing. Counted across the whole set rather than asserted
 *       on one row, because a single-row assertion cannot go red when the bug is a duplicate.</li>
 *   <li><strong>The cap defers, it does not reject.</strong> Past the configured monthly limit a
 *       referral stays {@code pending} for a human — a genuine flatshare must never be refused.</li>
 *   <li><strong>Raw addresses and User-Agents are never stored</strong>, and what is stored expires
 *       on the ninety-day clock.</li>
 * </ol>
 */
class ReferralQualificationTest extends AbstractApiTest {

    /** Matches the seeded {@code fees.referralQualifyPerMonth}. */
    private static final long SEEDED_CAP = 10L;

    private static final String UA = "PuneNestTest/1.0 (referral qualification)";
    private static final String IP = "203.0.113.7";

    @Autowired UserRepository users;
    @Autowired ReferralRepository referrals;
    @Autowired ReferralQualification qualification;
    @Autowired ReferralSignalRetention retention;
    @Autowired PlatformSettings settings;
    @Autowired EntityManager entityManager;

    /**
     * Move the cap, the way an admin would.
     *
     * <p>The clear matters: the whole test runs in one transaction, so a settings row already read
     * through JPA sits in the persistence context and a raw {@code UPDATE} underneath it would be
     * invisible to the next read. Without this the assertion would pass or fail depending on
     * whether the test had happened to read the setting first, which is the kind of order
     * dependence that turns up as a flake months later.
     */
    private void setCap(long cap) {
        jdbc.update("update settings set value = jsonb_set(value, "
                + "'{referralQualifyPerMonth}', ?::jsonb) where key = 'fees'", String.valueOf(cap));
        entityManager.clear();
    }

    // ---- fixtures ----

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Qualification User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private static String jsonField(String body, String field) {
        int i = body.indexOf("\"" + field + "\":\"") + field.length() + 4;
        return body.substring(i, body.indexOf('"', i));
    }

    /** The caller's own code, as the share screen would read it — and where their digests are set. */
    private String codeOf(User u, String ip, String userAgent) throws Exception {
        return jsonField(mvc.perform(get(Routes.Referrals.MINE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .header(HttpHeaders.USER_AGENT, userAgent)
                        .with(request -> {
                            request.setRemoteAddr(ip);
                            return request;
                        }))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(), "code");
    }

    private void redeem(User caller, String code, String shareChannel, String ip, String userAgent)
            throws Exception {
        String body = shareChannel == null
                ? "{\"code\":\"" + code + "\"}"
                : "{\"code\":\"" + code + "\",\"shareChannel\":\"" + shareChannel + "\"}";
        mvc.perform(post(Routes.Referrals.REDEEM)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .header(HttpHeaders.USER_AGENT, userAgent)
                        .with(request -> {
                            request.setRemoteAddr(ip);
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    /** One pending referral between two fresh users, redeemed from a different device. */
    private Referral referral(String referrerMobile, String referredMobile) throws Exception {
        User referrer = user(referrerMobile, "owner");
        User referred = user(referredMobile, "owner");
        redeem(referred, codeOf(referrer, "198.51.100.1", "Referrer/1.0"), null, IP, UA);
        return referrals.findByReferrerId(referrer.getId()).getFirst();
    }

    private Referral reload(UUID id) {
        return referrals.findById(id).orElseThrow();
    }

    // ---- 1: the qualifying action (D191, D56, Q17) ----

    @Test
    void aVerifiedFirstListingQualifiesTheReferral() throws Exception {
        Referral referral = referral("9866610010", "9866610011");
        assertThat(referral.getStatus()).isEqualTo(ReferralStatuses.PENDING);
        assertThat(referral.getQualifiedAt()).isNull();

        UUID owner = users.findByMobile(referral.getReferredMobile()).orElseThrow().getId();
        UUID property = UUID.randomUUID();
        Instant verifiedAt = Instant.now().truncatedTo(ChronoUnit.MILLIS);

        qualification.announceOwnershipVerified(owner, property, verifiedAt);

        Referral after = reload(referral.getId());
        assertThat(after.getStatus()).isEqualTo(ReferralStatuses.QUALIFIED);
        assertThat(after.getQualifiedPropertyId()).isEqualTo(property);
        assertThat(after.getQualifiedAt()).isNotNull();
        // `activated` was the same undelivered promise as `qualified`; the two move together now.
        assertThat(after.isActivated()).isTrue();
    }

    @Test
    void joiningAloneQualifiesNothing() throws Exception {
        Referral referral = referral("9866610020", "9866610021");
        // Redemption is the whole of "joined". Q17 rejected it as the trigger because a SIM costs
        // less than the credit it would mint.
        assertThat(reload(referral.getId()).getStatus()).isEqualTo(ReferralStatuses.PENDING);
        assertThat(reload(referral.getId()).isActivated()).isFalse();
    }

    @Test
    void aSecondVerifiedListingMintsNothingFurther() throws Exception {
        Referral referral = referral("9866610030", "9866610031");
        UUID owner = users.findByMobile(referral.getReferredMobile()).orElseThrow().getId();

        qualification.announceOwnershipVerified(owner, UUID.randomUUID(), Instant.now());
        Instant firstQualifiedAt = reload(referral.getId()).getQualifiedAt();
        UUID firstProperty = reload(referral.getId()).getQualifiedPropertyId();

        qualification.announceOwnershipVerified(owner, UUID.randomUUID(), Instant.now());

        // Counted across every referral this referrer has, not asserted on one row: if a second
        // announcement ever inserted a row instead of updating one, a single-row assertion would
        // still pass while the referrer collected twice.
        List<Referral> all = referrals.findByReferrerId(referral.getReferrerId());
        assertThat(all).hasSize(1);
        assertThat(all).filteredOn(r -> r.getQualifiedAt() != null).hasSize(1);
        assertThat(all.getFirst().getQualifiedPropertyId()).isEqualTo(firstProperty);
        assertThat(all.getFirst().getQualifiedAt()).isEqualTo(firstQualifiedAt);
    }

    @Test
    void reVerifyingTheSamePropertyIsIdempotent() throws Exception {
        Referral referral = referral("9866610040", "9866610041");
        UUID owner = users.findByMobile(referral.getReferredMobile()).orElseThrow().getId();
        UUID property = UUID.randomUUID();

        // A retried verification write announces again with the same arguments. The port's Javadoc
        // requires this to be survivable; re-verification after a lapse looks identical.
        qualification.announceOwnershipVerified(owner, property, Instant.now());
        Instant first = reload(referral.getId()).getQualifiedAt();
        qualification.announceOwnershipVerified(owner, property, Instant.now().plusSeconds(60));

        assertThat(referrals.findByReferrerId(referral.getReferrerId()))
                .filteredOn(r -> r.getQualifiedAt() != null).hasSize(1);
        assertThat(reload(referral.getId()).getQualifiedAt()).isEqualTo(first);
    }

    @Test
    void anOwnerWhoWasNeverReferredQualifiesNobody() throws Exception {
        User loner = user("9866610050", "owner");
        long before = referrals.count();

        qualification.announceOwnershipVerified(loner.getId(), UUID.randomUUID(), Instant.now());

        assertThat(referrals.count()).isEqualTo(before);
    }

    @Test
    void anAlreadyRejectedReferralIsNotResurrectedByALaterVerification() throws Exception {
        Referral referral = referral("9866610060", "9866610061");
        User staff = user("9866610062", "staff");
        mvc.perform(post("/referrals/" + referral.getId() + "/reject")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"desk test\"}"))
                .andExpect(status().isOk());

        UUID owner = users.findByMobile(referral.getReferredMobile()).orElseThrow().getId();
        qualification.announceOwnershipVerified(owner, UUID.randomUUID(), Instant.now());

        Referral after = reload(referral.getId());
        assertThat(after.getStatus()).isEqualTo(ReferralStatuses.REJECTED);
        assertThat(after.getQualifiedAt()).isNull();
    }

    // ---- 2: the cap (D61) ----

    @Test
    void theCapIsConfigurationAndDefaultsToTenAMonth() {
        assertThat(settings.referralQualifyPerMonth()).isEqualTo(SEEDED_CAP);

        setCap(2);
        assertThat(settings.referralQualifyPerMonth()).isEqualTo(2L);
    }

    @Test
    void pastTheCapAReferralWaitsForAHumanInsteadOfBeingRejected() throws Exception {
        // One is a cap a two-person flatshare would hit, which is the case D61 says must keep
        // working. The point of the assertion below is that it still does.
        setCap(1);

        User referrer = user("9866610070", "owner");
        String code = codeOf(referrer, "198.51.100.2", "Referrer/1.0");

        User flatmateOne = user("9866610071", "owner");
        User flatmateTwo = user("9866610072", "owner");
        redeem(flatmateOne, code, null, IP, UA);
        redeem(flatmateTwo, code, null, IP, UA);

        qualification.announceOwnershipVerified(flatmateOne.getId(), UUID.randomUUID(),
                Instant.now());
        qualification.announceOwnershipVerified(flatmateTwo.getId(), UUID.randomUUID(),
                Instant.now());

        List<Referral> all = referrals.findByReferrerId(referrer.getId());
        assertThat(all).hasSize(2);
        assertThat(all).filteredOn(r -> ReferralStatuses.QUALIFIED.equals(r.getStatus())).hasSize(1);
        // The overflow is pending, not rejected: a human decides, exactly as before Q17. Rejecting
        // it would be the automated velocity block D61 deliberately avoided.
        assertThat(all).filteredOn(r -> ReferralStatuses.PENDING.equals(r.getStatus())).hasSize(1);
        assertThat(all).noneMatch(r -> ReferralStatuses.REJECTED.equals(r.getStatus()));
    }

    @Test
    void qualificationsOlderThanTheWindowDoNotCountAgainstTheCap() throws Exception {
        setCap(1);

        User referrer = user("9866610080", "owner");
        String code = codeOf(referrer, "198.51.100.3", "Referrer/1.0");
        User longAgo = user("9866610081", "owner");
        User thisMonth = user("9866610082", "owner");
        redeem(longAgo, code, null, IP, UA);
        redeem(thisMonth, code, null, IP, UA);

        qualification.announceOwnershipVerified(longAgo.getId(), UUID.randomUUID(), Instant.now());
        // Age that qualification past the rolling window.
        jdbc.update("update referrals set qualified_at = now() - interval '100 days' "
                + "where referred_mobile = ?", longAgo.getMobile());

        qualification.announceOwnershipVerified(thisMonth.getId(), UUID.randomUUID(),
                Instant.now());

        assertThat(referrals.findByReferrerId(referrer.getId()))
                .filteredOn(r -> ReferralStatuses.QUALIFIED.equals(r.getStatus()))
                .hasSize(2);
    }

    // ---- 3: the share channel (D60) ----

    @Test
    void theShareChannelIsRecordedWhenTheClientReportsOne() throws Exception {
        User referrer = user("9866610090", "owner");
        User referred = user("9866610091", "owner");
        redeem(referred, codeOf(referrer, "198.51.100.4", "Referrer/1.0"),
                ShareChannels.WHATSAPP, IP, UA);

        Referral referral = referrals.findByReferrerId(referrer.getId()).getFirst();
        assertThat(referral.getShareChannel()).isEqualTo(ShareChannels.WHATSAPP);
        // `channel` is a different dimension and must not have been overwritten (D60).
        assertThat(referral.getChannel()).isEqualTo("owner");
    }

    @Test
    void anUnknownShareChannelIsDroppedRatherThanFailingTheRedemption() throws Exception {
        User referrer = user("9866610100", "owner");
        User referred = user("9866610101", "owner");
        // An older client, or a channel this build has no name for. Redemption must still succeed:
        // failing a real referral to protect an analytics field is the wrong trade.
        redeem(referred, codeOf(referrer, "198.51.100.5", "Referrer/1.0"),
                "carrier-pigeon", IP, UA);

        assertThat(referrals.findByReferrerId(referrer.getId()).getFirst().getShareChannel())
                .isNull();
    }

    @Test
    void everyDeclaredShareChannelIsAcceptedByTheDatabase() {
        // The vocabulary and the V64 CHECK failing apart is silent in one direction: a value the
        // constant set allows and the constraint refuses turns a good redemption into a 500.
        Set<String> declared = ShareChannels.all();
        assertThat(declared).isNotEmpty();
        for (String channel : declared) {
            assertThat(jdbc.queryForObject(
                    "select ?::text in ('whatsapp','sms','email','copy','qr','other')",
                    Boolean.class, channel))
                    .as("V64 accepts %s", channel)
                    .isTrue();
        }
    }

    // ---- 4: the correlation signals (D55) ----

    @Test
    void redeemingFromTheReferrersOwnDeviceIsFlagged() throws Exception {
        User referrer = user("9866610110", "owner");
        User referred = user("9866610111", "owner");
        String code = codeOf(referrer, IP, UA);
        redeem(referred, code, null, IP, UA);

        Referral referral = referrals.findByReferrerId(referrer.getId()).getFirst();
        assertThat(referral.isSameIp()).isTrue();
        assertThat(referral.isSameDevice()).isTrue();
        // A correlated pair is a reason to look, never a refusal: a couple sharing a router is the
        // platform's most common genuine referral.
        assertThat(referral.getStatus()).isEqualTo(ReferralStatuses.PENDING);
        assertThat(referral.getRisk()).isEqualTo("medium");
    }

    @Test
    void redeemingFromSomewhereElseIsNotFlagged() throws Exception {
        Referral referral = referral("9866610120", "9866610121");
        assertThat(referral.isSameIp()).isFalse();
        assertThat(referral.isSameDevice()).isFalse();
    }

    @Test
    void neitherTheAddressNorTheUserAgentIsEverStored() throws Exception {
        Referral referral = referral("9866610130", "9866610131");

        String ipHash = jdbc.queryForObject(
                "select referred_ip_hash from referrals where id = ?", String.class,
                referral.getId());
        String uaHash = jdbc.queryForObject(
                "select referred_device_hash from referrals where id = ?", String.class,
                referral.getId());

        assertThat(ipHash).isNotNull().matches("[0-9a-f]{64}").isNotEqualTo(IP).doesNotContain(IP);
        assertThat(uaHash).isNotNull().matches("[0-9a-f]{64}").doesNotContain("PuneNest");

        // Nothing on the wire carries them either: the DTO has no field for a digest, and the
        // fraud desk is served by the two booleans computed from them.
        String queue = mvc.perform(get(Routes.Referrals.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9866610132", "staff"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(queue).doesNotContain(ipHash).doesNotContain(uaHash).doesNotContain(IP);
    }

    @Test
    void digestsAreClearedOnceTheyLeaveTheRetentionWindow() throws Exception {
        Referral referral = referral("9866610140", "9866610141");
        UUID referrerId = referral.getReferrerId();

        int clearedWhileFresh = retention.expireSignalsOlderThan(
                Instant.now().minus(ReferralSignalRetention.RETENTION));
        assertThat(clearedWhileFresh).isZero();
        assertThat(jdbc.queryForObject("select referred_ip_hash from referrals where id = ?",
                String.class, referral.getId())).isNotNull();

        retention.expireSignalsOlderThan(Instant.now().plusSeconds(1));

        assertThat(jdbc.queryForObject("select referred_ip_hash from referrals where id = ?",
                String.class, referral.getId())).isNull();
        assertThat(jdbc.queryForObject("select referred_device_hash from referrals where id = ?",
                String.class, referral.getId())).isNull();
        assertThat(jdbc.queryForObject("select referrer_ip_hash from referral_codes where user_id = ?",
                String.class, referrerId)).isNull();
        assertThat(jdbc.queryForObject("select signals_at from referral_codes where user_id = ?",
                Object.class, referrerId)).isNull();

        // The findings outlive the evidence — clearing a digest must not erase what it proved.
        Referral after = reload(referral.getId());
        assertThat(after.isSameIp()).isFalse();
        assertThat(after.getStatus()).isEqualTo(ReferralStatuses.PENDING);
        assertThat(after.getRewardAmount()).isPositive();
    }
}
