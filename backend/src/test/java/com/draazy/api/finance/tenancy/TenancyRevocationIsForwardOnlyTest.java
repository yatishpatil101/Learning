package com.draazy.api.finance.tenancy;

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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Revoking a stay is <strong>forward-only</strong>, and that is a decision rather than an oversight
 * (D204).
 *
 * <p>D194 let an owner confirm a self-declared stay, and a confirmation is what authorises a review.
 * The obvious next question is what happens to a review that has already been written when the owner
 * takes the confirmation back. The answer is: nothing. The review stays exactly where it is, reads
 * exactly as it did, and keeps its {@code tenant} badge. Revocation only closes the door for
 * <em>future</em> reviews.
 *
 * <p><strong>Why, so that nobody "fixes" this later.</strong> A review is a person's own account of
 * their own experience, and the owner of the listing being reviewed is the last party who should be
 * able to delete it. Retraction would hand every landlord a one-tap silencer for criticism: confirm
 * the stay, wait for the review, revoke on reading it. The declaration exists to prove the reviewer
 * was really there — a fact about the past, which revoking cannot alter. What revocation genuinely
 * says is "I no longer stand behind this claim", and its honest consequence is that the claim stops
 * buying anything new. Abuse of the confirm → review → revoke sequence is answered by the audit
 * trail {@code TenancyDeclarationService.decide} writes and by review moderation, both of which are
 * held by somebody other than the accused.
 *
 * <p>This test therefore pins <em>both</em> halves. Either one alone is satisfiable by a mistake:
 * a system that retracts nothing and also gates nothing would pass the first, and one that wipes the
 * review would pass the second.
 */
@DisplayName("Tenancy — a revoked stay is forward-only (D204)")
class TenancyRevocationIsForwardOnlyTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    // ---- fixtures ----

    private User user(String mobile, String name) {
        User u = new User(mobile, "buyer");
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "2BHK in Wakad", "rent", "apartment", 22000L,
                "Wakad", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("900"));
        p.setStatus(PropertyStatus.APPROVED);
        return properties.saveAndFlush(p);
    }

    private String declare(User claimant, Property p) throws Exception {
        String json = mvc.perform(post("/properties/" + p.getId() + "/tenancy-declarations")
                        .header(HttpHeaders.AUTHORIZATION, bearer(claimant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"livedFrom\":\"2024-01-01\",\"livedTo\":\"2025-06-30\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return com.jayway.jsonpath.JsonPath.read(json, "$.id");
    }

    private void decide(User owner, String declarationId, String verb, String expectedStatus)
            throws Exception {
        mvc.perform(post("/tenancy-declarations/" + declarationId + "/" + verb)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(expectedStatus));
    }

    /** The published reviews of one listing, verbatim — the exact bytes a reader would receive. */
    private String publishedReviews(Property p) throws Exception {
        return mvc.perform(get("/properties/" + p.getId() + "/reviews"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private int reviewAttempt(User author, Property p, String body) throws Exception {
        return mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":4,\"body\":\"%s\"}".formatted(body)))
                .andReturn().getResponse().getStatus();
    }

    // ---- the ruling ----

    @Test
    @DisplayName("the review already written survives untouched, and the next one is refused")
    void revocationRetractsNothingAndAuthorisesNothingFurther() throws Exception {
        User owner = user("9844100001", "Nikhil Rane");
        User wrote = user("9844100002", "Sneha Kale");
        User writesLater = user("9844100003", "Rohit Jadhav");
        Property p = listing(owner);

        // --- half one: a review exists, on a confirmed stay ---
        String confirmed = declare(wrote, p);
        decide(owner, confirmed, "confirm", TenancyDeclarationStatuses.CONFIRMED);
        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(wrote))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":2,\"body\":\"Damp in both bedrooms all monsoon.\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.context").value("tenant"));

        String before = publishedReviews(p);
        // Guard against the whole test being vacuous: if the review were not published to begin
        // with, "unchanged after revoke" would be true of an empty list and would prove nothing.
        assertThat(before).contains("Damp in both bedrooms all monsoon.").contains("\"tenant\"");

        // The owner takes the confirmation back — precisely the move a landlord would make on
        // reading that review.
        decide(owner, confirmed, "revoke", TenancyDeclarationStatuses.REVOKED);

        // Byte-for-byte, deliberately. Not "still present": the review must not be hidden, nor
        // silently stripped of the `tenant` badge that says the author really lived there, nor
        // dropped out of the count the rating summary is built from. A weaker assertion would pass
        // against a de-badged review, which is the most tempting half-measure of the lot.
        assertThat(publishedReviews(p)).isEqualTo(before);

        // --- half two: and the door is shut behind it ---
        String revoked = declare(writesLater, p);
        decide(owner, revoked, "confirm", TenancyDeclarationStatuses.CONFIRMED);
        decide(owner, revoked, "revoke", TenancyDeclarationStatuses.REVOKED);

        // 422 and not 409: this account has never reviewed this listing, so it is refused for want
        // of standing rather than for repeating itself. Same property as the surviving review on
        // purpose — what changed is this person's standing, not anything about the flat.
        assertThat(reviewAttempt(writesLater, p, "Lived here briefly.")).isEqualTo(422);

        // And the first review is still there after all of it.
        assertThat(publishedReviews(p)).isEqualTo(before);
    }
}
