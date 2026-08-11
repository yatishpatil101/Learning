package com.punenest.api.engagement.review;

import com.punenest.api.support.AbstractApiTest;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The rating summary for a society, locality or owner — one route, three kinds of target.
 *
 * <p><strong>What was actually wrong, and why it is worse than the property case.</strong> D79 gave
 * {@code /properties/&#123;propId&#125;/reviews} a server-computed summary because the property page
 * was reducing the list in the browser. That list is unpaged (D8.6), so the browser's arithmetic was
 * at least <em>right</em>; the defect was structural — three displayed numbers were correct only as
 * a side effect of the list never being paged.
 *
 * <p>{@code /reviews/&#123;entityType&#125;/&#123;entityId&#125;} has been paged since S27, twenty
 * rows by default, and the society hub, the owner profile and the locality reviews block have each
 * been reducing that page into a star average and calling it the rating. Here the failure has
 * already happened. {@link #summaryIsOverTheWholeCorpusNotOnePage} is the assertion that pins it:
 * twenty-five reviews, a count no page of twenty can produce.
 *
 * <p><strong>One route rather than three.</strong> {@link ReviewTargetKey} resolves the public
 * identifier a client holds — a society slug <em>or</em> id, a locality slug, an owner's user id —
 * into the one canonical {@code target_id} the table stores, and 404s anything it cannot find. Past
 * that point a society and a locality differ only in two strings, so the three tests below exercise
 * the same code down to the query parameters. What is worth testing per type is therefore not the
 * arithmetic but the <em>key</em>: that each type's summary counts the rows that type actually
 * stores, which is the failure a bespoke endpoint per type would hide behind three green tests.
 *
 * <p>Rows go in through {@code jdbc} rather than the write endpoint for the same reason
 * {@link PropertyReviewSummaryTest} does it: one review per author means four distinct ratings would
 * need four users, and that machinery would obscure the arithmetic under test.
 */
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

    /**
     * A locality created for this test rather than a seeded one.
     *
     * <p>The seeded set is shared with every other fixture in the suite, so asserting an exact
     * average against one of them makes this test's arithmetic depend on reference data it does not
     * own. Two columns is the whole row — every other NOT NULL carries a default.
     */
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
        // 5, 5, 3, 1 -> 3.5. The rejected 1-star must move nothing, and its Safety: 1 would drag
        // that aspect from 4.5 to 3.3 if the moderation filter were missing from the aggregate.
        //
        // The aspects are the society vocabulary (ReviewCategories.SOCIETY_KEYS), which is what
        // the hub's bars are labelled with -- Safety, Maintenance, Management, Amenities,
        // Connectivity.
        review(ReviewTargetTypes.SOCIETY, id, 5, "{\"Safety\":5,\"Maintenance\":4}");
        review(ReviewTargetTypes.SOCIETY, id, 5, "{\"Safety\":4}");
        // `locality` rides along on a published row. It is a real key -- for a property -- and the
        // write path now refuses it here, but a pre-split row or a hand-run insert can still hold
        // one. Asserting it does not surface is what pins the read filter to the *target's*
        // vocabulary rather than to a union of all of them.
        review(ReviewTargetTypes.SOCIETY, id, 3, "{\"Management\":2,\"locality\":5}");
        review(ReviewTargetTypes.SOCIETY, id, 1, "{}");
        review(ReviewTargetTypes.SOCIETY, id, 1, ReviewStatuses.REJECTED, "{\"Safety\":1}");

        // No Authorization header: as public as the list, for the same reason -- this is the
        // evidence an anonymous visitor is weighing before they will consider signing up.
        mvc.perform(get("/reviews/society/" + slug + "/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.avgRating").value(3.5))
                .andExpect(jsonPath("$.reviewCount").value(4))
                // The two empty buckets are the assertion that matters: a `group by rating` would
                // omit them, and a bar chart with a missing bar is not the same picture as one
                // with a zero-height bar.
                .andExpect(jsonPath("$.distribution['1']").value(1))
                .andExpect(jsonPath("$.distribution['2']").value(0))
                .andExpect(jsonPath("$.distribution['3']").value(1))
                .andExpect(jsonPath("$.distribution['4']").value(0))
                .andExpect(jsonPath("$.distribution['5']").value(2))
                // Safety: 5 and 4 -> 4.5. Over all four published reviews it would be 2.25 --
                // the sparse denominator is the point, and it is what the society hub's bars need.
                .andExpect(jsonPath("$.categoryAverages.Safety").value(4.5))
                .andExpect(jsonPath("$.categoryAverages.Maintenance").value(4.0))
                .andExpect(jsonPath("$.categoryAverages.Management").value(2.0))
                // Nobody rated these two, and an aspect nobody rated is absent, not 0.
                .andExpect(jsonPath("$.categoryAverages.Amenities").doesNotExist())
                .andExpect(jsonPath("$.categoryAverages.Connectivity").doesNotExist())
                // A property aspect on a society row: stored, never published.
                .andExpect(jsonPath("$.categoryAverages.locality").doesNotExist());
    }

    @Test
    @DisplayName("a society summary is the same whether addressed by slug or by id")
    void societySummaryAcceptsEitherIdentifier() throws Exception {
        String slug = anySocietySlug();
        String id = societyIdOf(slug);
        review(ReviewTargetTypes.SOCIETY, id, 4, "{\"Safety\":4}");
        review(ReviewTargetTypes.SOCIETY, id, 5, "{\"Safety\":5}");

        // Reviews key on the immutable id, but the hub navigated to /societies/{slug} and holds
        // only a slug. Both identifiers must reach the same rows, or the number on the page
        // depends on which link the visitor arrived through.
        for (String identifier : new String[] {slug, id}) {
            mvc.perform(get("/reviews/society/" + identifier + "/summary"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.avgRating").value(4.5))
                    .andExpect(jsonPath("$.reviewCount").value(2))
                    .andExpect(jsonPath("$.categoryAverages.Safety").value(4.5));
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

        mvc.perform(get("/reviews/locality/" + slug + "/summary"))
                .andExpect(status().isOk())
                // 13/3 = 4.333... -> 4.3 at one decimal. Exercises HALF_UP and RATING_SCALE
                // rather than leaving them a no-op the way an exact average would.
                .andExpect(jsonPath("$.avgRating").value(4.3))
                .andExpect(jsonPath("$.reviewCount").value(3))
                .andExpect(jsonPath("$.categoryAverages.locality").value(4.5));
    }

    @Test
    @DisplayName("an owner summary counts the rows keyed on their user id")
    void ownerSummaryKeysOnTheUserId() throws Exception {
        User o = owner("9850000001");
        String id = o.getId().toString();
        review(ReviewTargetTypes.OWNER, id, 5, "{\"owner\":5}");
        review(ReviewTargetTypes.OWNER, id, 4, "{\"owner\":4}");
        review(ReviewTargetTypes.OWNER, id, 2, ReviewStatuses.PENDING, "{\"owner\":1}");

        mvc.perform(get("/reviews/owner/" + id + "/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.avgRating").value(4.5))
                .andExpect(jsonPath("$.reviewCount").value(2))
                // A pending review is not yet an opinion, so it is neither counted nor averaged.
                .andExpect(jsonPath("$.categoryAverages.owner").value(4.5))
                .andExpect(jsonPath("$.distribution['2']").value(0));
    }

    // ------------------------------------------------------ the point of the item

    @Test
    @DisplayName("the summary is over every published review, not over the first page of them")
    void summaryIsOverTheWholeCorpusNotOnePage() throws Exception {
        String slug = locality("summary-fixture-kothrud");
        // Twenty 5s and five 1s. The list route pages at 20 by default and caps at 100, so a
        // client reducing page one can arrive at 5.0, or at 4.0, or at any average of some twenty
        // of these rows -- but it cannot arrive at a count of 25. That is the whole defect this
        // endpoint exists to remove, and it is the one assertion here that no page can fake.
        for (int i = 0; i < 20; i++) {
            review(ReviewTargetTypes.LOCALITY, slug, 5, "{\"locality\":5}");
        }
        for (int i = 0; i < 5; i++) {
            review(ReviewTargetTypes.LOCALITY, slug, 1, "{\"locality\":1}");
        }

        mvc.perform(get("/reviews/locality/" + slug + "/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reviewCount").value(25))
                // (20*5 + 5*1) / 25 = 4.2.
                .andExpect(jsonPath("$.avgRating").value(4.2))
                .andExpect(jsonPath("$.distribution['5']").value(20))
                .andExpect(jsonPath("$.distribution['1']").value(5))
                .andExpect(jsonPath("$.categoryAverages.locality").value(4.2));

        // And the list it sits beside is untouched: still paged, still 20 on page one. This
        // endpoint is additive, exactly as the property summary was.
        mvc.perform(get("/reviews/locality/" + slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(20))
                .andExpect(jsonPath("$.totalElements").value(25));
    }

    // -------------------------------------------------------------- edge cases

    @Test
    @DisplayName("an unreviewed entity has no average, a zero count and five empty buckets")
    void unreviewedEntityDoesNotDivideByZero() throws Exception {
        String slug = locality("summary-fixture-empty");

        mvc.perform(get("/reviews/locality/" + slug + "/summary"))
                .andExpect(status().isOk())
                // Null, not 0.0. No rating is not a rating of zero, and this is the case that
                // would be a divide-by-zero if the average were reduced in Java.
                .andExpect(jsonPath("$.avgRating").doesNotExist())
                .andExpect(jsonPath("$.reviewCount").value(0))
                .andExpect(jsonPath("$.distribution['1']").value(0))
                .andExpect(jsonPath("$.distribution['3']").value(0))
                .andExpect(jsonPath("$.distribution['5']").value(0))
                .andExpect(jsonPath("$.categoryAverages").isMap())
                .andExpect(jsonPath("$.categoryAverages.locality").doesNotExist());
    }

    @Test
    @DisplayName("an entity whose only reviews are unpublished reads as unreviewed, not as an error")
    void onlyUnpublishedReviewsReadsAsUnreviewed() throws Exception {
        User o = owner("9850000002");
        String id = o.getId().toString();
        review(ReviewTargetTypes.OWNER, id, 5, ReviewStatuses.PENDING, "{\"owner\":5}");
        review(ReviewTargetTypes.OWNER, id, 1, ReviewStatuses.REJECTED, "{\"owner\":1}");

        mvc.perform(get("/reviews/owner/" + id + "/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.avgRating").doesNotExist())
                .andExpect(jsonPath("$.reviewCount").value(0))
                .andExpect(jsonPath("$.categoryAverages.owner").doesNotExist());
    }

    @Test
    @DisplayName("a junk or out-of-range category value costs that entry, not the endpoint")
    void malformedCategoryEntriesAreSurvivable() throws Exception {
        String slug = locality("summary-fixture-junk");
        // None of these can be written through the API -- ReviewCategories closes the key set and
        // bounds the value. They are what a seed, a hand-run UPDATE or a pre-validation import can
        // leave behind, and a cast error here would 500 the rating strip for every anonymous
        // visitor to the locality page.
        review(ReviewTargetTypes.LOCALITY, slug, 4, "{\"bogus\":3,\"owner\":\"five\",\"value\":4}");
        review(ReviewTargetTypes.LOCALITY, slug, 2, "[1,2,3]");
        // 99 is admitted by the type guard as readily as 4 is; without the range guard this
        // publishes locality = 51.5 against a scale the client draws as 5, and nothing raises.
        review(ReviewTargetTypes.LOCALITY, slug, 3, "{\"locality\":99}");
        review(ReviewTargetTypes.LOCALITY, slug, 3, "{\"locality\":4}");

        mvc.perform(get("/reviews/locality/" + slug + "/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.avgRating").value(3.0))
                .andExpect(jsonPath("$.reviewCount").value(4))
                .andExpect(jsonPath("$.categoryAverages.value").value(4.0))
                // 4, not 51.5: a value that was never on the scale is not evidence of anything.
                .andExpect(jsonPath("$.categoryAverages.locality").value(4.0))
                .andExpect(jsonPath("$.categoryAverages.bogus").doesNotExist())
                .andExpect(jsonPath("$.categoryAverages.owner").doesNotExist());
    }

    @Test
    @DisplayName("an unknown entity type is 404, not a zeroed summary of a target kind we invented")
    void unknownEntityTypeIs404() throws Exception {
        mvc.perform(get("/reviews/banana/whatever/summary"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("property is not an entity type here, so it 404s rather than shadowing its own route")
    void propertyIsNotAnEntityTarget() throws Exception {
        // The contract's entityType enum is disjoint from `property` on purpose, and a second way
        // to reach a property's summary would be a second thing to keep in step with the first.
        mvc.perform(get("/reviews/property/" + UUID.randomUUID() + "/summary"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("an unknown entity id is 404, not a confident summary of nothing")
    void unknownEntityIdIs404() throws Exception {
        // A zeroed summary here would read as "this neighbourhood has no reviews yet" for a
        // neighbourhood that does not exist -- resolution is the existence check.
        mvc.perform(get("/reviews/society/no-such-society-anywhere/summary"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/reviews/locality/no-such-locality-anywhere/summary"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/reviews/owner/" + UUID.randomUUID() + "/summary"))
                .andExpect(status().isNotFound());
        // A malformed id is the same 404 as a well-formed miss, deliberately (D35): answering
        // differently tells a caller which of the two they hit.
        mvc.perform(get("/reviews/owner/not-a-uuid/summary"))
                .andExpect(status().isNotFound());
    }
}
