package com.draazy.api.identity.verification;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.cashfree.WebhookSignature;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The <em>payoff</em> of the identity badge — D95.
 *
 * <p>{@link VerificationEndpointsTest} proves the badge is granted correctly. This class proves it is
 * worth anything: that earning it flips {@code properties.owner_verified} on the listings the owner
 * holds, which is what buyers read on a listing card and what the ranking treats as a trust signal.
 *
 * <p><strong>Why this needed its own writer.</strong> The column, the entity field and the
 * {@code PropertyResponse} member all existed and had done for a long time; nothing anywhere set
 * them outside the seed. That is the shape of gap that survives review, because every individual
 * piece looks present — and the failure it produces is silent rather than loud: the funnel completes,
 * the owner sees a green pill on their profile, and every listing they hold goes on telling buyers
 * the owner is unverified. The "verified owners rank higher" promise the whole opt-in flow is sold on
 * simply does nothing, and no test fails.
 */
class VerifiedOwnerListingsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    IdentityVerificationRepository verifications;
    @Autowired
    WebhookSignature webhookSignature;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Meera Deshpande");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title, String status, boolean archived) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus(status);
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        if (archived) {
            p.archive("test");
        }
        return properties.saveAndFlush(p);
    }

    /** Start a flow and return its correlation {@code ref}. */
    private String start(User u) throws Exception {
        String json = mvc.perform(post(Routes.Verification.AADHAAR)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll("^.*?\"ref\":\"([^\"]+)\".*$", "$1");
    }

    /** Deliver a correctly-signed DigiLocker success for {@code ref}. */
    private void confirm(String ref, String mobile, String identityHash) throws Exception {
        String body = "{\"type\":\"DIGILOCKER_VERIFICATION_SUCCESS\",\"ref\":\"" + ref
                + "\",\"status\":\"SUCCESS\",\"data\":{\"maskedAadhaar\":\"XXXX XXXX 1234\","
                + "\"mobile\":\"" + mobile + "\",\"identityHash\":\"" + identityHash + "\"}}";
        String ts = String.valueOf(System.currentTimeMillis());
        mvc.perform(post(Routes.Webhooks.CASHFREE_DIGILOCKER)
                        .header("x-webhook-timestamp", ts)
                        .header("x-webhook-signature", webhookSignature.sign(ts, body))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());
    }

    @Test
    void earningTheBadgeMarksEveryListingTheOwnerHolds() throws Exception {
        String mobile = "9830000101";
        User u = owner(mobile);
        Property approved = listing(u, "Approved flat", "approved", false);
        Property pending = listing(u, "Pending flat", "pending", false);
        Property archived = listing(u, "Archived flat", "approved", true);

        // Control: unverified means unverified, or the assertions below could pass against a fixture
        // that was already flipped.
        assertThat(approved.isOwnerVerified()).isFalse();

        confirm(start(u), mobile, "hash-101");

        /* All three, and that breadth is the assertion rather than an accident of the query. The badge
         * belongs to the *owner*, not to any one listing's lifecycle: a pending listing owned by a
         * verified person has a verified owner, and an archived one must not come back from restore
         * claiming otherwise. A `status = 'approved'` filter here would look tidier and be wrong. */
        assertThat(properties.findById(approved.getId()).orElseThrow().isOwnerVerified()).isTrue();
        assertThat(properties.findById(pending.getId()).orElseThrow().isOwnerVerified()).isTrue();
        assertThat(properties.findById(archived.getId()).orElseThrow().isOwnerVerified()).isTrue();
    }

    @Test
    void anotherOwnersListingsAreUntouched() throws Exception {
        String mobile = "9830000102";
        User verifying = owner(mobile);
        User bystander = owner("9830000103");
        Property mine = listing(verifying, "My flat", "approved", false);
        Property theirs = listing(bystander, "Their flat", "approved", false);

        confirm(start(verifying), mobile, "hash-102");

        assertThat(properties.findById(mine.getId()).orElseThrow().isOwnerVerified()).isTrue();
        // The obvious way to get this wrong is an update with no owner predicate, which would pass
        // every assertion in the test above.
        assertThat(properties.findById(theirs.getId()).orElseThrow().isOwnerVerified()).isFalse();
    }

    @Test
    void aListingPostedAfterVerifyingIsBornVerified() throws Exception {
        String mobile = "9830000104";
        User u = owner(mobile);
        confirm(start(u), mobile, "hash-104");

        /* The back-fill above cannot cover this case, and that is the point of asserting it
         * separately. `handleWebhook` returns early on an already-verified row — deliberately, so a
         * provider retry cannot re-stamp `verifiedAt` — which means replaying the webhook is not a
         * repair path. If `ListingService.create` did not inherit the flag from the owner, a verified
         * owner's newest listing would be the one that looks untrusted, permanently. */
        String json = mvc.perform(post(Routes.MeListings.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Posted afterwards\",\"deal\":\"rent\","
                                + "\"propertyType\":\"apartment\",\"price\":25000,"
                                + "\"locality\":\"Baner\",\"city\":\"Pune\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        assertThat(json).contains("\"ownerVerified\":true");
    }

    @Test
    void verifyingWithNoListingsIsHarmless() throws Exception {
        String mobile = "9830000105";
        User u = owner(mobile);

        confirm(start(u), mobile, "hash-105");

        // The badge still lands — the listing write is a consequence of verification, never a
        // precondition for it. A buyer who owns nothing must be able to verify.
        assertThat(verifications.findByUserId(u.getId()).orElseThrow().isBadge()).isTrue();
        assertThat(users.findById(u.getId()).orElseThrow().isAadhaarVerified()).isTrue();
    }
}
