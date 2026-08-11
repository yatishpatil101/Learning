package com.punenest.api.engagement.review;

import com.punenest.api.support.AbstractApiTest;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The rating summary — that the database computes it, and that adding it changed nothing (D79).
 *
 * <p><strong>What was actually wrong.</strong> Nothing, yet: {@code GET
 * /properties/&#123;propId&#125;/reviews} is unpaged by ruling D8.6, the per-target UNIQUE index
 * really does bound it, and the property page really could reduce the whole array into a star
 * average, a 1–5 distribution and five per-aspect averages. The defect was structural — three
 * displayed numbers were correct only as a side effect of the list never being paged, so the day
 * anyone paged it the page would keep rendering them, now silently describing page one and looking
 * exactly as authoritative as before. A number that can become wrong without anything looking
 * broken is worth a test on its own terms.
 *
 * <p>So the load-bearing assertions here are in two groups. First, that each figure is what SQL says
 * over <em>every</em> published review: the distribution buckets including the empty ones, the
 * per-aspect averages over only the reviews that answered each aspect, and the moderation filter
 * applying to all of it. Second — and this is the half a summary endpoint usually forgets —
 * {@link #listEndpointIsUnchanged}, which pins the existing list to the bare, unpaged array it has
 * always been. This item was only worth doing if it cost no client a change.
 *
 * <p>Rows go in through {@code jdbc} rather than the write endpoint on purpose. Posting a review
 * requires a completed visit or a tenancy per author, so producing four different ratings would mean
 * four users and four eligibility fixtures — machinery that proves {@link ReviewEndpointsTest}'s
 * point rather than this one, and that would make the arithmetic under test harder to read than the
 * arithmetic itself.
 */
@DisplayName("Engagement — the property rating summary")
class PropertyReviewSummaryTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    private User user(String mobile, String name) {
        User u = new User(mobile, "owner");
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "3BHK in Baner", "rent", "apartment", 42000L,
                "Baner", "Pune");
        p.setBhk(new BigDecimal("3"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1400"));
        p.setStatus(PropertyStatus.APPROVED);
        return properties.saveAndFlush(p);
    }

    /** One review of {@code p}, with an author-less row so the one-per-author index stays out of it. */
    private void review(Property p, int rating, String status, String categoriesJson) {
        jdbc.update("insert into reviews (target_type, target_id, rating, status, categories) "
                        + "values ('property', ?, ?, ?, cast(? as jsonb))",
                p.getId().toString(), rating, status, categoriesJson);
    }

    /**
     * Four published reviews rated 5, 5, 3, 1 — average 3.5 — plus one rejected 1-star that must
     * move nothing, and whose {@code locality: 1} would drag that aspect from 4.5 to 3.3 if the
     * moderation filter were missing from the aggregate but present in the list.
     */
    private Property reviewedListing(String mobile) {
        Property p = listing(user(mobile, "Asha Patil"));
        review(p, 5, ReviewStatuses.PUBLISHED, "{\"locality\":5,\"condition\":4}");
        review(p, 5, ReviewStatuses.PUBLISHED, "{\"locality\":4}");
        review(p, 3, ReviewStatuses.PUBLISHED, "{\"value\":2}");
        review(p, 1, ReviewStatuses.PUBLISHED, "{}");
        review(p, 1, ReviewStatuses.REJECTED, "{\"locality\":1}");
        return p;
    }

    // ------------------------------------------------------------- the numbers

    @Test
    @DisplayName("the average and count are the database's, over published reviews only, and public")
    void averageAndCountComeFromTheDatabase() throws Exception {
        Property p = reviewedListing("9840000001");

        // No Authorization header: the summary is as public as the list, because it is the same
        // evidence an anonymous visitor is weighing before they will consider signing up.
        mvc.perform(get("/properties/" + p.getId() + "/reviews/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.avgRating").value(3.5))
                .andExpect(jsonPath("$.reviewCount").value(4));
    }

    @Test
    @DisplayName("every star bucket is present, including the ones nobody used")
    void distributionIsZeroFilledAcrossAllFiveBuckets() throws Exception {
        Property p = reviewedListing("9840000002");

        // 5,5,3,1 published. The two empty buckets are the assertion that matters: a `group by
        // rating` would omit them, and a bar chart with a missing bar and one with a zero-height
        // bar are not the same picture -- only one of them is true.
        mvc.perform(get("/properties/" + p.getId() + "/reviews/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.distribution['1']").value(1))
                .andExpect(jsonPath("$.distribution['2']").value(0))
                .andExpect(jsonPath("$.distribution['3']").value(1))
                .andExpect(jsonPath("$.distribution['4']").value(0))
                // Two 5s, and the rejected 1-star has not become a second entry in bucket 1.
                .andExpect(jsonPath("$.distribution['5']").value(2));
    }

    @Test
    @DisplayName("each aspect averages over the reviews that answered it, not over all of them")
    void categoryAveragesUseTheRightDenominator() throws Exception {
        Property p = reviewedListing("9840000003");

        mvc.perform(get("/properties/" + p.getId() + "/reviews/summary"))
                .andExpect(status().isOk())
                // locality: 5 and 4 -> 4.5. Over all four published reviews it would be 2.25, and
                // over all five it would be 2.5; the sparse denominator is the whole point.
                .andExpect(jsonPath("$.categoryAverages.locality").value(4.5))
                .andExpect(jsonPath("$.categoryAverages.condition").value(4.0))
                .andExpect(jsonPath("$.categoryAverages.value").value(2.0))
                // Nobody rated these, so they are absent rather than 0 -- which would read as
                // "everyone hated the owner" instead of "nobody said".
                .andExpect(jsonPath("$.categoryAverages.owner").doesNotExist())
                .andExpect(jsonPath("$.categoryAverages.accuracy").doesNotExist());
    }

    // ------------------------------------------------------------- edge cases

    @Test
    @DisplayName("an unreviewed listing has no average, a zero count and five empty buckets")
    void unreviewedListingDoesNotDivideByZero() throws Exception {
        Property p = listing(user("9840000004", "Nikhil Rao"));

        mvc.perform(get("/properties/" + p.getId() + "/reviews/summary"))
                .andExpect(status().isOk())
                // Null, not 0.0. No rating is not a rating of zero, and this is the case that
                // would have been an NPE or a divide-by-zero if the average were reduced in Java.
                .andExpect(jsonPath("$.avgRating").doesNotExist())
                .andExpect(jsonPath("$.reviewCount").value(0))
                .andExpect(jsonPath("$.distribution['1']").value(0))
                .andExpect(jsonPath("$.distribution['5']").value(0))
                .andExpect(jsonPath("$.categoryAverages").isMap())
                .andExpect(jsonPath("$.categoryAverages.locality").doesNotExist());
    }

    @Test
    @DisplayName("a listing whose only reviews are unpublished reads as unreviewed, not as an error")
    void onlyUnpublishedReviewsReadsAsUnreviewed() throws Exception {
        Property p = listing(user("9840000005", "Meera Shah"));
        review(p, 5, ReviewStatuses.PENDING, "{\"locality\":5}");
        review(p, 1, ReviewStatuses.REJECTED, "{\"locality\":1}");

        mvc.perform(get("/properties/" + p.getId() + "/reviews/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.avgRating").doesNotExist())
                .andExpect(jsonPath("$.reviewCount").value(0))
                .andExpect(jsonPath("$.categoryAverages.locality").doesNotExist());
    }

    @Test
    @DisplayName("a junk category key or a non-numeric value costs that entry, not the endpoint")
    void malformedCategoryEntriesAreSurvivable() throws Exception {
        Property p = listing(user("9840000006", "Vikram Desai"));
        // Neither of these can be written through the API -- ReviewCategories closes the key set
        // and bounds the value. They are what a seeded row, a hand-run UPDATE or a pre-V16 import
        // can leave behind, and the aggregate has to survive them: a cast error here would 500 the
        // rating strip for every anonymous visitor to the listing.
        review(p, 4, ReviewStatuses.PUBLISHED, "{\"bogus\":3,\"owner\":\"five\",\"value\":4}");
        review(p, 2, ReviewStatuses.PUBLISHED, "[1,2,3]");

        mvc.perform(get("/properties/" + p.getId() + "/reviews/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.avgRating").value(3.0))
                .andExpect(jsonPath("$.reviewCount").value(2))
                // The one well-formed, in-vocabulary entry survives; the other three do not appear.
                .andExpect(jsonPath("$.categoryAverages.value").value(4.0))
                .andExpect(jsonPath("$.categoryAverages.bogus").doesNotExist())
                .andExpect(jsonPath("$.categoryAverages.owner").doesNotExist());
    }

    @Test
    @DisplayName("an out-of-range category value is dropped rather than published as an average")
    void outOfRangeCategoryValuesAreDropped() throws Exception {
        Property p = listing(user("9840000009", "Nikhil Rane"));
        // Same provenance as the malformed entries above -- unreachable through the API, reachable
        // through a seed or a hand-run UPDATE. The type guard admits 99 as readily as 4, so without
        // a range guard this publishes locality = 51.5 against a scale the client draws as 5. That
        // failure is worse than the cast error next door precisely because nothing raises.
        review(p, 4, ReviewStatuses.PUBLISHED, "{\"locality\":99,\"value\":4}");
        review(p, 4, ReviewStatuses.PUBLISHED, "{\"locality\":4,\"value\":0}");

        mvc.perform(get("/properties/" + p.getId() + "/reviews/summary"))
                .andExpect(status().isOk())
                // 4, not 51.5: the 99 is excluded from the mean entirely rather than clamped to 5,
                // because a value that was never on the scale is not evidence of anything.
                .andExpect(jsonPath("$.categoryAverages.locality").value(4.0))
                // 0 is below the scale as surely as 99 is above it, so the only survivor is the 4.
                .andExpect(jsonPath("$.categoryAverages.value").value(4.0));
    }

    @Test
    @DisplayName("an average that is not exact at one decimal is rounded half-up, not truncated")
    void averagesAreRoundedHalfUpNotTruncated() throws Exception {
        Property p = listing(user("9840000010", "Rhea Kulkarni"));
        // Every other fixture here averages to something already exact at one decimal, which makes
        // the rounding a no-op and leaves RATING_SCALE, HALF_UP and BigDecimal.valueOf untested --
        // a switch to DOWN, to a scale of 2, or to new BigDecimal(double) would pass all of them.
        // 13/3 = 4.333... and 17/4 = 4.25 distinguish every one of those.
        review(p, 5, ReviewStatuses.PUBLISHED, "{\"locality\":5}");
        review(p, 4, ReviewStatuses.PUBLISHED, "{\"locality\":4}");
        review(p, 4, ReviewStatuses.PUBLISHED, "{\"locality\":4}");
        review(p, 4, ReviewStatuses.PUBLISHED, "{}");

        mvc.perform(get("/properties/" + p.getId() + "/reviews/summary"))
                .andExpect(status().isOk())
                // 17/4 = 4.25 -> 4.3 under HALF_UP, 4.2 under HALF_EVEN or DOWN.
                .andExpect(jsonPath("$.avgRating").value(4.3))
                // 13/3 = 4.333... -> 4.3 at one decimal, 4.33 if the scale ever widens.
                .andExpect(jsonPath("$.categoryAverages.locality").value(4.3));
    }

    @Test
    @DisplayName("the summary of an unknown property is 404, not a zeroed summary")
    void unknownPropertyIs404() throws Exception {
        mvc.perform(get("/properties/" + UUID.randomUUID() + "/reviews/summary"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a locality whose reviews are all author-less lists them instead of returning 500")
    void authorlessEntityReviewsDoNotBlowUp() throws Exception {
        // The nullable-author guard was originally written out at three call sites and fixed at
        // one. This is the public, anonymous path that was left: authorNames() returns Map.of()
        // when no row on the page has an author, and an immutable map answers a null key with an
        // NPE rather than with "absent". Seeded reviews carry no author_id -- V16's uniqueness
        // index is partial (where author_id is not null) precisely because of them -- so this is a
        // 500 waiting on data, not on code.
        // The locality has to exist before the review can be read back: listForEntity resolves the
        // slug through ReviewTargetKey and 404s an unknown one, which would make this test pass for
        // the wrong reason. Two columns is the whole row -- every other NOT NULL has a default.
        jdbc.update("insert into localities (slug, name) values ('baner-test', 'Baner Test')");
        jdbc.update("insert into reviews (target_type, target_id, rating, status, categories) "
                        + "values ('locality', 'baner-test', 5, ?, cast('{\"locality\":5}' as jsonb))",
                ReviewStatuses.PUBLISHED);

        mvc.perform(get("/reviews/locality/baner-test"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                // The name is absent rather than fabricated -- an anonymous review stays anonymous.
                .andExpect(jsonPath("$.content[0].authorName").doesNotExist());
    }

    // ------------------------------------------------- the contract that held

    @Test
    @DisplayName("the existing list endpoint returns exactly what it returned before")
    void listEndpointIsUnchanged() throws Exception {
        Property p = reviewedListing("9840000007");

        // The regression this whole item was chosen to avoid. Still a bare array -- not an object,
        // not a page envelope -- still every published review rather than a default page of them,
        // and still carrying the same fields. If any of these four assertions ever needs relaxing,
        // the summary above is what makes that a decision instead of a silent breakage.
        mvc.perform(get("/properties/" + p.getId() + "/reviews"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray())
                .andExpect(jsonPath("$.length()").value(4))
                .andExpect(jsonPath("$.content").doesNotExist())
                .andExpect(jsonPath("$.page").doesNotExist())
                .andExpect(jsonPath("$[0].rating").exists())
                .andExpect(jsonPath("$[0].targetType").value("property"))
                .andExpect(jsonPath("$[0].categories").exists());
    }
}
