package com.draazy.api.engagement.review;

import com.draazy.api.support.AbstractApiTest;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;

/** Rows go in through {@code jdbc}, as posting reviews needs per-author visit or tenancy fixtures that would obscure the arithmetic under test. */
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

    /** The rejected 1-star must move nothing: its {@code locality: 1} would drag that aspect from 4.5 to 3.3. */
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
    @DisplayName("the figures are the database's over published reviews only, and public")
    void summaryNumbersComeFromTheDatabase() throws Exception {
        Property p = reviewedListing("9840000001");

        // No Authorization header: the summary is as public as the list, because it is the same
        // evidence an anonymous visitor is weighing before they will consider signing up.
        mvc.perform(get("/properties/" + p.getId() + "/reviews"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.avgRating").value(3.5))
                .andExpect(jsonPath("$.summary.reviewCount").value(4))
                // The two empty buckets matter: `group by rating` would omit them, and a missing bar isn't zero.
                .andExpect(jsonPath("$.summary.distribution['1']").value(1))
                .andExpect(jsonPath("$.summary.distribution['2']").value(0))
                .andExpect(jsonPath("$.summary.distribution['3']").value(1))
                .andExpect(jsonPath("$.summary.distribution['4']").value(0))
                // Two 5s, and the rejected 1-star has not become a second entry in bucket 1.
                .andExpect(jsonPath("$.summary.distribution['5']").value(2))
                // locality: 5 and 4 -> 4.5. Over all four published reviews it would be 2.25, and
                // over all five it would be 2.5; the sparse denominator is the whole point.
                .andExpect(jsonPath("$.summary.categoryAverages.locality").value(4.5))
                .andExpect(jsonPath("$.summary.categoryAverages.condition").value(4.0))
                .andExpect(jsonPath("$.summary.categoryAverages.value").value(2.0))
                // Nobody rated these, so they are absent rather than 0 -- which would read as
                // "everyone hated the owner" instead of "nobody said".
                .andExpect(jsonPath("$.summary.categoryAverages.owner").doesNotExist())
                .andExpect(jsonPath("$.summary.categoryAverages.accuracy").doesNotExist());
    }

    // ------------------------------------------------------------- edge cases

    @ParameterizedTest(name = "{0}")
    @DisplayName("a listing with no published reviews has no average, a zero count and five empty buckets")
    @ValueSource(strings = {"no reviews at all", "only pending and rejected reviews"})
    void unreviewedListingDoesNotDivideByZero(String scenario) throws Exception {
        Property p = listing(user("9840000004", "Nikhil Rao"));
        if (scenario.startsWith("only")) {
            review(p, 5, ReviewStatuses.PENDING, "{\"locality\":5}");
            review(p, 1, ReviewStatuses.REJECTED, "{\"locality\":1}");
        }

        mvc.perform(get("/properties/" + p.getId() + "/reviews"))
                .andExpect(status().isOk())
                // Null, not 0.0. No rating is not a rating of zero, and this is the case that
                // would have been an NPE or a divide-by-zero if the average were reduced in Java.
                .andExpect(jsonPath("$.summary.avgRating").doesNotExist())
                .andExpect(jsonPath("$.summary.reviewCount").value(0))
                .andExpect(jsonPath("$.summary.distribution['1']").value(0))
                .andExpect(jsonPath("$.summary.distribution['5']").value(0))
                .andExpect(jsonPath("$.summary.categoryAverages").isMap())
                .andExpect(jsonPath("$.summary.categoryAverages.locality").doesNotExist());
    }

    @Test
    @DisplayName("a junk category key or a non-numeric value costs that entry, not the endpoint")
    void malformedCategoryEntriesAreSurvivable() throws Exception {
        Property p = listing(user("9840000006", "Vikram Desai"));
        // Not writable through the API (ReviewCategories closes the key set and bounds the value) but reachable via a seed or hand-run UPDATE;
        // the aggregate must survive them, as a cast error would 500 the rating strip for every anonymous visitor.
        review(p, 4, ReviewStatuses.PUBLISHED, "{\"bogus\":3,\"owner\":\"five\",\"value\":4}");
        review(p, 2, ReviewStatuses.PUBLISHED, "[1,2,3]");

        mvc.perform(get("/properties/" + p.getId() + "/reviews"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.avgRating").value(3.0))
                .andExpect(jsonPath("$.summary.reviewCount").value(2))
                // The one well-formed, in-vocabulary entry survives; the other three do not appear.
                .andExpect(jsonPath("$.summary.categoryAverages.value").value(4.0))
                .andExpect(jsonPath("$.summary.categoryAverages.bogus").doesNotExist())
                .andExpect(jsonPath("$.summary.categoryAverages.owner").doesNotExist());
    }

    @Test
    @DisplayName("an out-of-range category value is dropped rather than published as an average")
    void outOfRangeCategoryValuesAreDropped() throws Exception {
        Property p = listing(user("9840000009", "Nikhil Rane"));
        // Reachable via a seed or hand-run UPDATE: the type guard admits 99 as readily as 4, so without a range guard this publishes
        // locality = 51.5 against a scale the client draws as 5, and nothing raises.
        review(p, 4, ReviewStatuses.PUBLISHED, "{\"locality\":99,\"value\":4}");
        review(p, 4, ReviewStatuses.PUBLISHED, "{\"locality\":4,\"value\":0}");

        mvc.perform(get("/properties/" + p.getId() + "/reviews"))
                .andExpect(status().isOk())
                // 4, not 51.5: the 99 is excluded from the mean entirely rather than clamped to 5,
                // because a value that was never on the scale is not evidence of anything.
                .andExpect(jsonPath("$.summary.categoryAverages.locality").value(4.0))
                // 0 is below the scale as surely as 99 is above it, so the only survivor is the 4.
                .andExpect(jsonPath("$.summary.categoryAverages.value").value(4.0));
    }

    @Test
    @DisplayName("an average that is not exact at one decimal is rounded half-up, not truncated")
    void averagesAreRoundedHalfUpNotTruncated() throws Exception {
        Property p = listing(user("9840000010", "Rhea Kulkarni"));
        // Other fixtures average to exact one-decimal values, hiding rounding; 13/3 = 4.333... and 17/4 = 4.25
        // catch a switch to DOWN, scale 2 or new BigDecimal(double).
        review(p, 5, ReviewStatuses.PUBLISHED, "{\"locality\":5}");
        review(p, 4, ReviewStatuses.PUBLISHED, "{\"locality\":4}");
        review(p, 4, ReviewStatuses.PUBLISHED, "{\"locality\":4}");
        review(p, 4, ReviewStatuses.PUBLISHED, "{}");

        mvc.perform(get("/properties/" + p.getId() + "/reviews"))
                .andExpect(status().isOk())
                // 17/4 = 4.25 -> 4.3 under HALF_UP, 4.2 under HALF_EVEN or DOWN.
                .andExpect(jsonPath("$.summary.avgRating").value(4.3))
                // 13/3 = 4.333... -> 4.3 at one decimal, 4.33 if the scale ever widens.
                .andExpect(jsonPath("$.summary.categoryAverages.locality").value(4.3));
    }

    @Test
    @DisplayName("the summary of an unknown property is 404, not a zeroed summary")
    void unknownPropertyIs404() throws Exception {
        mvc.perform(get("/properties/" + UUID.randomUUID() + "/reviews"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a locality whose reviews are all author-less lists them instead of returning 500")
    void authorlessEntityReviewsDoNotBlowUp() throws Exception {
        // Public anonymous path: authorNames() returns Map.of() when no row has an author (seeded reviews carry none), and an immutable map NPEs on a null key.
        // The locality must exist first, as listForEntity 404s an unknown slug, which would pass for the wrong reason.
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
    @DisplayName("the list is unpaged, carries every published review, and the summary is beside it")
    void listCarriesEveryReviewAndTheSummary() throws Exception {
        Property p = reviewedListing("9840000007");

        mvc.perform(get("/properties/" + p.getId() + "/reviews"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(4))
                .andExpect(jsonPath("$.totalElements").value(4))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.content[0].rating").exists())
                .andExpect(jsonPath("$.content[0].targetType").value("property"))
                .andExpect(jsonPath("$.content[0].categories").exists())
                .andExpect(jsonPath("$.summary.reviewCount").value(4));
    }
}
