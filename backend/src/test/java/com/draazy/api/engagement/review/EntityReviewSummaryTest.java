package com.draazy.api.engagement.review;

import com.draazy.api.support.AbstractApiTest;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;

/** One route, three target kinds: the summary must cover the whole corpus, not one page of 20 (hence 25 reviews),
 * and count the rows each type stores. */
@DisplayName("Engagement — the society / locality / owner rating summary")
class EntityReviewSummaryTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    // ----------------------------------------------------------------- fixtures

    /** One published review of {@code (type, id)}, author-less so one-per-author stays out of it. */
    private void review(String type, String id, int rating, String categoriesJson) {
        review(type, id, rating, ReviewStatuses.PUBLISHED, categoriesJson);
    }

    private void review(String type, String id, int rating, String status, String categoriesJson) {
        jdbc.update("insert into reviews (target_type, target_id, rating, status, categories) "
                        + "values (?, ?, ?, ?, cast(? as jsonb))",
                type, id, rating, status, categoriesJson);
    }

    /** Any seeded society; {@code ReviewEndpointsTest} establishes these start with no reviews. */
    private String anySocietySlug() {
        return jdbc.queryForObject("select slug from societies order by slug limit 1", String.class);
    }

    private String societyIdOf(String slug) {
        return jdbc.queryForObject("select id::text from societies where slug = ?",
                String.class, slug);
    }

    /** A locality made for this test: an exact average on a shared seeded one would depend on unowned data. */
    private String locality(String slug) {
        jdbc.update("insert into localities (slug, name) values (?, ?)", slug, "Fixture " + slug);
        return slug;
    }

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    // -------------------------------------------------------------- the numbers

    @Test
    @DisplayName("a society's average and count are the database's, over published reviews only")
    void societySummaryComesFromTheDatabase() throws Exception {
        String slug = anySocietySlug();
        String id = societyIdOf(slug);
        // 5, 5, 3, 1 -> 3.5: the rejected 1-star must move nothing (its Safety: 1 would drag 4.5 to 3.3).
        review(ReviewTargetTypes.SOCIETY, id, 5, "{\"Safety\":5,\"Maintenance\":4}");
        review(ReviewTargetTypes.SOCIETY, id, 5, "{\"Safety\":4}");
        // A `locality` key on a published row must not surface: the filter uses the target's own vocabulary.
        review(ReviewTargetTypes.SOCIETY, id, 3, "{\"Management\":2,\"locality\":5}");
        review(ReviewTargetTypes.SOCIETY, id, 1, "{}");
        review(ReviewTargetTypes.SOCIETY, id, 1, ReviewStatuses.REJECTED, "{\"Safety\":1}");

        // No Authorization header: as public as the list, for the same reason -- this is the
        // evidence an anonymous visitor is weighing before they will consider signing up.
        mvc.perform(get("/reviews/society/" + slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.avgRating").value(3.5))
                .andExpect(jsonPath("$.summary.reviewCount").value(4))
                // The two empty buckets matter: `group by rating` would omit them, and a missing bar isn't zero.
                .andExpect(jsonPath("$.summary.distribution['1']").value(1))
                .andExpect(jsonPath("$.summary.distribution['2']").value(0))
                .andExpect(jsonPath("$.summary.distribution['3']").value(1))
                .andExpect(jsonPath("$.summary.distribution['4']").value(0))
                .andExpect(jsonPath("$.summary.distribution['5']").value(2))
                // Safety: 5 and 4 -> 4.5. Over all four published reviews it would be 2.25 --
                // the sparse denominator is the point, and it is what the society hub's bars need.
                .andExpect(jsonPath("$.summary.categoryAverages.Safety").value(4.5))
                .andExpect(jsonPath("$.summary.categoryAverages.Maintenance").value(4.0))
                .andExpect(jsonPath("$.summary.categoryAverages.Management").value(2.0))
                // Nobody rated these two, and an aspect nobody rated is absent, not 0.
                .andExpect(jsonPath("$.summary.categoryAverages.Amenities").doesNotExist())
                .andExpect(jsonPath("$.summary.categoryAverages.Connectivity").doesNotExist())
                // A property aspect on a society row: stored, never published.
                .andExpect(jsonPath("$.summary.categoryAverages.locality").doesNotExist());
    }

    @Test
    @DisplayName("a society summary is the same whether addressed by slug or by id")
    void societySummaryAcceptsEitherIdentifier() throws Exception {
        String slug = anySocietySlug();
        String id = societyIdOf(slug);
        review(ReviewTargetTypes.SOCIETY, id, 4, "{\"Safety\":4}");
        review(ReviewTargetTypes.SOCIETY, id, 5, "{\"Safety\":5}");

        // Reviews key on the immutable id but the hub holds only a slug; both must reach the same rows.
        for (String identifier : new String[] {slug, id}) {
            mvc.perform(get("/reviews/society/" + identifier))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.summary.avgRating").value(4.5))
                    .andExpect(jsonPath("$.summary.reviewCount").value(2))
                    .andExpect(jsonPath("$.summary.categoryAverages.Safety").value(4.5));
        }
    }

    @Test
    @DisplayName("a locality summary counts the rows keyed on its slug, which is its primary key")
    void localitySummaryKeysOnTheSlug() throws Exception {
        String slug = locality("summary-fixture-baner");
        review(ReviewTargetTypes.LOCALITY, slug, 5, "{\"locality\":5}");
        review(ReviewTargetTypes.LOCALITY, slug, 4, "{\"locality\":4}");
        review(ReviewTargetTypes.LOCALITY, slug, 4, "{}");
        // Same id, different target_type. If the aggregate ignored target_type -- the one thing a
        // shared route makes easy to drop -- this would land in the locality's average.
        review(ReviewTargetTypes.SOCIETY, slug, 1, "{\"locality\":1}");

        mvc.perform(get("/reviews/locality/" + slug))
                .andExpect(status().isOk())
                // 13/3 = 4.333... -> 4.3 at one decimal. Exercises HALF_UP and RATING_SCALE
                // rather than leaving them a no-op the way an exact average would.
                .andExpect(jsonPath("$.summary.avgRating").value(4.3))
                .andExpect(jsonPath("$.summary.reviewCount").value(3))
                .andExpect(jsonPath("$.summary.categoryAverages.locality").value(4.5));
    }

    @Test
    @DisplayName("an owner summary counts the rows keyed on their user id")
    void ownerSummaryKeysOnTheUserId() throws Exception {
        User o = owner("9850000001");
        String id = o.getId().toString();
        review(ReviewTargetTypes.OWNER, id, 5, "{\"owner\":5}");
        review(ReviewTargetTypes.OWNER, id, 4, "{\"owner\":4}");
        review(ReviewTargetTypes.OWNER, id, 2, ReviewStatuses.PENDING, "{\"owner\":1}");

        mvc.perform(get("/reviews/owner/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.avgRating").value(4.5))
                .andExpect(jsonPath("$.summary.reviewCount").value(2))
                // A pending review is not yet an opinion, so it is neither counted nor averaged.
                .andExpect(jsonPath("$.summary.categoryAverages.owner").value(4.5))
                .andExpect(jsonPath("$.summary.distribution['2']").value(0));
    }

    // ------------------------------------------------------ the point of the item

    @Test
    @DisplayName("the summary is over every published review, not over the first page of them")
    void summaryIsOverTheWholeCorpusNotOnePage() throws Exception {
        String slug = locality("summary-fixture-kothrud");
        // Twenty 5s and five 1s: a client reducing page one (20 default, 100 max) can never reach a count of 25.
        for (int i = 0; i < 20; i++) {
            review(ReviewTargetTypes.LOCALITY, slug, 5, "{\"locality\":5}");
        }
        for (int i = 0; i < 5; i++) {
            review(ReviewTargetTypes.LOCALITY, slug, 1, "{\"locality\":1}");
        }

        mvc.perform(get("/reviews/locality/" + slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.reviewCount").value(25))
                // (20*5 + 5*1) / 25 = 4.2.
                .andExpect(jsonPath("$.summary.avgRating").value(4.2))
                .andExpect(jsonPath("$.summary.distribution['5']").value(20))
                .andExpect(jsonPath("$.summary.distribution['1']").value(5))
                .andExpect(jsonPath("$.summary.categoryAverages.locality").value(4.2))
                // The cards stay paged: 20 on page one, while the summary beside them covers all 25.
                .andExpect(jsonPath("$.content.length()").value(20))
                .andExpect(jsonPath("$.totalElements").value(25));
    }

    // -------------------------------------------------------------- edge cases

    @Test
    @DisplayName("an unreviewed entity has no average, a zero count and five empty buckets")
    void unreviewedEntityDoesNotDivideByZero() throws Exception {
        String slug = locality("summary-fixture-empty");

        mvc.perform(get("/reviews/locality/" + slug))
                .andExpect(status().isOk())
                // Null, not 0.0. No rating is not a rating of zero, and this is the case that
                // would be a divide-by-zero if the average were reduced in Java.
                .andExpect(jsonPath("$.summary.avgRating").doesNotExist())
                .andExpect(jsonPath("$.summary.reviewCount").value(0))
                .andExpect(jsonPath("$.summary.distribution['1']").value(0))
                .andExpect(jsonPath("$.summary.distribution['3']").value(0))
                .andExpect(jsonPath("$.summary.distribution['5']").value(0))
                .andExpect(jsonPath("$.summary.categoryAverages").isMap())
                .andExpect(jsonPath("$.summary.categoryAverages.locality").doesNotExist());
    }

    @Test
    @DisplayName("an entity whose only reviews are unpublished reads as unreviewed, not as an error")
    void onlyUnpublishedReviewsReadsAsUnreviewed() throws Exception {
        User o = owner("9850000002");
        String id = o.getId().toString();
        review(ReviewTargetTypes.OWNER, id, 5, ReviewStatuses.PENDING, "{\"owner\":5}");
        review(ReviewTargetTypes.OWNER, id, 1, ReviewStatuses.REJECTED, "{\"owner\":1}");

        mvc.perform(get("/reviews/owner/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.avgRating").doesNotExist())
                .andExpect(jsonPath("$.summary.reviewCount").value(0))
                .andExpect(jsonPath("$.summary.categoryAverages.owner").doesNotExist());
    }

    @Test
    @DisplayName("a junk or out-of-range category value costs that entry, not the endpoint")
    void malformedCategoryEntriesAreSurvivable() throws Exception {
        String slug = locality("summary-fixture-junk");
        // Not writable via the API, but seeds or imports can leave them; a cast error would 500 the rating strip.
        review(ReviewTargetTypes.LOCALITY, slug, 4, "{\"bogus\":3,\"owner\":\"five\",\"value\":4}");
        review(ReviewTargetTypes.LOCALITY, slug, 2, "[1,2,3]");
        // 99 is admitted by the type guard as readily as 4 is; without the range guard this
        // publishes locality = 51.5 against a scale the client draws as 5, and nothing raises.
        review(ReviewTargetTypes.LOCALITY, slug, 3, "{\"locality\":99}");
        review(ReviewTargetTypes.LOCALITY, slug, 3, "{\"locality\":4}");

        mvc.perform(get("/reviews/locality/" + slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.avgRating").value(3.0))
                .andExpect(jsonPath("$.summary.reviewCount").value(4))
                .andExpect(jsonPath("$.summary.categoryAverages.value").value(4.0))
                // 4, not 51.5: a value that was never on the scale is not evidence of anything.
                .andExpect(jsonPath("$.summary.categoryAverages.locality").value(4.0))
                .andExpect(jsonPath("$.summary.categoryAverages.bogus").doesNotExist())
                .andExpect(jsonPath("$.summary.categoryAverages.owner").doesNotExist());
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("an unknown target is 404, not a zeroed summary of nothing")
    @CsvSource(delimiter = '|', value = {
            "unknown entity type | /reviews/banana/whatever",
            "property is not an entity type here | /reviews/property/00000000-0000-0000-0000-000000000000",
            "unknown society | /reviews/society/no-such-society-anywhere",
            "unknown locality | /reviews/locality/no-such-locality-anywhere",
            "unknown owner | /reviews/owner/00000000-0000-0000-0000-000000000000",
            "malformed owner id is the same 404 as a miss | /reviews/owner/not-a-uuid"
    })
    void unknownTargetIs404(String label, String path) throws Exception {
        mvc.perform(get(path))
                .andExpect(status().isNotFound());
    }
}
