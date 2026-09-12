package com.draazy.api.engagement.review;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.deals.visit.Visit;
import com.draazy.api.deals.visit.VisitRepository;
import com.draazy.api.deals.visit.VisitStatuses;
import com.draazy.api.finance.tenancy.Tenancy;
import com.draazy.api.finance.tenancy.TenancyRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
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
 * Contract + behaviour proof for reviews.
 *
 * <p><strong>What is at stake here is different from every earlier slice.</strong> Elsewhere the
 * risk was "can I read someone else's row?". Reviews are the trust surface, so the failure mode is a
 * caller <em>writing</em> rows they have not earned — stacking a listing with praise, burying a
 * rival, or forging the "Verified resident" badge that makes a review worth believing. That rule
 * used to live in {@code ReviewsSection.jsx}: in the browser, which is to say nowhere. The
 * load-bearing assertions below are therefore the eligibility refusals, the derived-not-supplied
 * badge, and one-review-per-author.
 *
 * <p>Runs against the live Flyway'd Postgres so V16's UNIQUE index is the real one. Rows are
 * created in-test and rolled back.
 */
@DisplayName("Engagement — reviews")
class ReviewEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    VisitRepository visits;
    @Autowired
    TenancyRepository tenancies;

    private User user(String mobile, String name) {
        User u = new User(mobile, "buyer");
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "2BHK in Kothrud", "rent", "apartment", 25000L,
                "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        p.setStatus(PropertyStatus.APPROVED);
        return properties.saveAndFlush(p);
    }

    /** A completed visit — the weaker of the two eligibility proofs. */
    private void completedVisit(User visitor, Property p) {
        Visit v = new Visit(p.getId(), visitor.getId(),
                Instant.now().minus(2, ChronoUnit.DAYS), "in-person", null);
        v.setStatus(VisitStatuses.COMPLETED);
        visits.saveAndFlush(v);
    }

    private void tenancy(User tenant, Property p, String status) {
        Tenancy t = new Tenancy(p.getId(), tenant.getId(), p.getOwner().getId());
        t.setStatus(status);
        tenancies.saveAndFlush(t);
    }

    private String body(int rating) {
        return "{\"rating\":" + rating + ",\"body\":\"Clean building, responsive owner.\"}";
    }

    // ------------------------------------------------------------ public read

    @Test
    @DisplayName("property reviews are readable with no token at all")
    void propertyReviewsArePublic() throws Exception {
        User owner = user("9810000001", "Asha Patil");
        Property p = listing(owner);

        mvc.perform(get("/properties/" + p.getId() + "/reviews"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());
    }

    @Test
    @DisplayName("entity reviews are public and paged, clamp page size, and ignore a hostile sort")
    void entityReviewsArePagedAndPublic() throws Exception {
        String slug = anySocietySlug();

        mvc.perform(get("/reviews/society/" + slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray())
                .andExpect(jsonPath("$.page").exists())
                .andExpect(jsonPath("$.size").exists());

        mvc.perform(get("/reviews/society/" + slug + "?size=100000"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));

        // Spring binds ?sort= even though this endpoint offers none; an unknown property would
        // otherwise reach the query and 500 for any anonymous caller who guesses a query string.
        mvc.perform(get("/reviews/society/" + slug + "?sort=nosuchfield,desc"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("an unknown entity slug is 404, not an empty page")
    void unknownEntityIs404() throws Exception {
        mvc.perform(get("/reviews/society/no-such-society-anywhere"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("an unknown entity type is rejected rather than stored as a new target kind")
    void unknownEntityTypeIsRejected() throws Exception {
        mvc.perform(get("/reviews/banana/whatever"))
                .andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------ eligibility

    @Test
    @DisplayName("a stranger with no visit and no tenancy cannot review a listing")
    void strangerCannotReview() throws Exception {
        User owner = user("9810000002", "Asha Patil");
        User stranger = user("9820000002", "Rahul Joshi");
        Property p = listing(owner);

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON).content(body(5)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error").value("review_not_eligible"));
    }

    @Test
    @DisplayName("an owner cannot review their own listing even if they somehow visited it")
    void ownerCannotReviewOwnListing() throws Exception {
        User owner = user("9810000003", "Asha Patil");
        Property p = listing(owner);
        completedVisit(owner, p);

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON).content(body(5)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error").value("review_not_eligible"));
    }

    @Test
    @DisplayName("a scheduled-but-not-completed visit does not earn a review")
    void bookedVisitIsNotEnough() throws Exception {
        User owner = user("9810000004", "Asha Patil");
        User visitor = user("9820000004", "Rahul Joshi");
        Property p = listing(owner);

        Visit v = new Visit(p.getId(), visitor.getId(),
                Instant.now().plus(2, ChronoUnit.DAYS), "in-person", null);
        v.setStatus(VisitStatuses.SCHEDULED);
        visits.saveAndFlush(v);

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON).content(body(4)))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("anonymous cannot post a review")
    void anonymousCannotReview() throws Exception {
        User owner = user("9810000005", "Asha Patil");
        Property p = listing(owner);

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .contentType(MediaType.APPLICATION_JSON).content(body(4)))
                .andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------- the derived badge

    @Test
    @DisplayName("a completed visit earns a 'visit' badge, derived server-side")
    void completedVisitEarnsVisitBadge() throws Exception {
        User owner = user("9810000006", "Asha Patil");
        User visitor = user("9820000006", "Rahul Joshi");
        Property p = listing(owner);
        completedVisit(visitor, p);

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON).content(body(4)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.context").value("visit"))
                .andExpect(jsonPath("$.author").value("Rahul Joshi"))
                .andExpect(jsonPath("$.targetType").value("property"));
    }

    @Test
    @DisplayName("a tenancy outranks a visit — a resident is never downgraded to 'visited'")
    void tenancyOutranksVisit() throws Exception {
        User owner = user("9810000007", "Asha Patil");
        User tenant = user("9820000007", "Rahul Joshi");
        Property p = listing(owner);
        completedVisit(tenant, p);
        tenancy(tenant, p, "active");

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON).content(body(5)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.context").value("tenant"));
    }

    @Test
    @DisplayName("an ended tenancy still earns the resident badge — they still lived there")
    void endedTenancyStillCounts() throws Exception {
        User owner = user("9810000008", "Asha Patil");
        User tenant = user("9820000008", "Rahul Joshi");
        Property p = listing(owner);
        tenancy(tenant, p, "ended");

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON).content(body(4)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.context").value("tenant"));
    }

    @Test
    @DisplayName("a client-supplied context is ignored — the badge cannot be forged")
    void contextCannotBeForged() throws Exception {
        User owner = user("9810000009", "Asha Patil");
        User visitor = user("9820000009", "Rahul Joshi");
        Property p = listing(owner);
        completedVisit(visitor, p);

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":5,\"context\":\"tenant\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.context").value("visit"));
    }

    // --------------------------------------------------------- one per author

    @Test
    @DisplayName("a second review of the same listing by the same author is refused")
    void oneReviewPerAuthorPerTarget() throws Exception {
        User owner = user("9810000010", "Asha Patil");
        User visitor = user("9820000010", "Rahul Joshi");
        Property p = listing(owner);
        completedVisit(visitor, p);

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON).content(body(5)))
                .andExpect(status().isCreated());

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON).content(body(1)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("already_reviewed"));
    }

    // -------------------------------------------------------- categories JSONB

    @Test
    @DisplayName("valid sub-ratings round-trip; unknown keys and out-of-range values are refused")
    void categoriesAreValidatedAgainstAClosedKeySet() throws Exception {
        User owner = user("9810000012", "Asha Patil");
        User visitor = user("9820000012", "Rahul Joshi");
        Property p = listing(owner);
        completedVisit(visitor, p);

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":4,\"categories\":{\"locality\":5,\"value\":3},"
                                + "\"recommend\":true}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.categories.locality").value(5))
                .andExpect(jsonPath("$.categories.value").value(3))
                .andExpect(jsonPath("$.recommend").value(true));

        User other = user("9820000013", "Meera Kulkarni");
        completedVisit(other, p);

        // A junk key would turn the column into a junk drawer nothing can aggregate.
        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(other))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":4,\"categories\":{\"vibes\":5}}"))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(other))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":4,\"categories\":{\"locality\":9}}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("an omitted recommend stays null — 'did not say' is not 'would not recommend'")
    void recommendIsNullableNotFalse() throws Exception {
        User owner = user("9810000014", "Asha Patil");
        User visitor = user("9820000014", "Rahul Joshi");
        Property p = listing(owner);
        completedVisit(visitor, p);

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON).content(body(4)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.recommend").doesNotExist());
    }

    @Test
    @DisplayName("rating is required and bounded 1-5")
    void ratingIsValidated() throws Exception {
        User owner = user("9810000015", "Asha Patil");
        User visitor = user("9820000015", "Rahul Joshi");
        Property p = listing(owner);
        completedVisit(visitor, p);

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"rating\":9}"))
                .andExpect(status().isUnprocessableEntity());

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnprocessableEntity());
    }

    // ------------------------------------------------------------- moderation

    @Test
    @DisplayName("unpublished reviews never reach the public read")
    void onlyPublishedReviewsAreListed() throws Exception {
        User owner = user("9810000016", "Asha Patil");
        User a = user("9820000016", "Rahul Joshi");
        Property p = listing(owner);

        jdbc.update("insert into reviews (target_type, target_id, author_id, rating, status) "
                + "values ('property', ?, ?, 5, 'published')", p.getId().toString(), a.getId());
        jdbc.update("insert into reviews (target_type, target_id, rating, status) "
                + "values ('property', ?, 1, 'rejected')", p.getId().toString());
        jdbc.update("insert into reviews (target_type, target_id, rating, status) "
                + "values ('property', ?, 1, 'pending')", p.getId().toString());

        mvc.perform(get("/properties/" + p.getId() + "/reviews"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].rating").value(5));
    }

    @Test
    @DisplayName("reviews of an unknown property are 404, not an empty list")
    void unknownPropertyIs404() throws Exception {
        mvc.perform(get("/properties/" + UUID.randomUUID() + "/reviews"))
                .andExpect(status().isNotFound());
    }

    // ---------------------------------------------------- entity review writes

    @Test
    @DisplayName("a society review keys on the immutable id, whether addressed by slug or id")
    void societyReviewsKeyOnTheImmutableId() throws Exception {
        User author = user("9820000017", "Rahul Joshi");
        String slug = anySocietySlug();
        String id = jdbc.queryForObject(
                "select id::text from societies where slug = ?", String.class, slug);

        mvc.perform(post("/reviews/society/" + slug)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON).content(body(4)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.targetType").value("society"))
                // Stored against the id, so a future rename cannot orphan it.
                .andExpect(jsonPath("$.targetId").value(id))
                // No visit or tenancy concept for a society, so no badge.
                .andExpect(jsonPath("$.context").doesNotExist());

        // Addressing the same society by id must find the review written via the slug.
        mvc.perform(get("/reviews/society/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1));
    }

    @Test
    @DisplayName("society rating aggregates now appear on the society hub, computed not stored")
    void societyHubShowsComputedRating() throws Exception {
        String slug = anySocietySlug();
        String id = jdbc.queryForObject(
                "select id::text from societies where slug = ?", String.class, slug);

        mvc.perform(get("/societies/" + slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reviewCount").value(0))
                .andExpect(jsonPath("$.avgRating").doesNotExist());

        jdbc.update("insert into reviews (target_type, target_id, rating, status) "
                + "values ('society', ?, 5, 'published')", id);
        jdbc.update("insert into reviews (target_type, target_id, rating, status) "
                + "values ('society', ?, 4, 'published')", id);
        // A rejected review must not move the average.
        jdbc.update("insert into reviews (target_type, target_id, rating, status) "
                + "values ('society', ?, 1, 'rejected')", id);

        mvc.perform(get("/societies/" + slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reviewCount").value(2))
                .andExpect(jsonPath("$.avgRating").value(4.5));
    }

    @Test
    @DisplayName("the society directory carries the same aggregate, so cards need no extra request")
    void societyDirectoryCarriesRating() throws Exception {
        String slug = anySocietySlug();
        String id = jdbc.queryForObject(
                "select id::text from societies where slug = ?", String.class, slug);
        // `q` searches name and builder, not the slug — searching by slug here would silently match
        // nothing and the assertions would run against an empty page.
        String name = jdbc.queryForObject(
                "select name from societies where slug = ?", String.class, slug);

        // Unrated: absent, not zero. A card that renders 0.0 for an unreviewed society is stating
        // something false about it, so the aggregate has to be able to say "no opinion yet".
        mvc.perform(get("/societies").param("q", name))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].reviewCount").value(0))
                .andExpect(jsonPath("$.content[0].avgRating").doesNotExist());

        jdbc.update("insert into reviews (target_type, target_id, rating, status) "
                + "values ('society', ?, 5, 'published')", id);
        jdbc.update("insert into reviews (target_type, target_id, rating, status) "
                + "values ('society', ?, 4, 'published')", id);
        jdbc.update("insert into reviews (target_type, target_id, rating, status) "
                + "values ('society', ?, 1, 'rejected')", id);

        // Identical to the hub's answer: one aggregate, two surfaces. If these ever disagree the
        // directory is computing its own, which is how a star silently means two different things.
        mvc.perform(get("/societies").param("q", name))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].reviewCount").value(2))
                .andExpect(jsonPath("$.content[0].avgRating").value(4.5));
    }

    @Test
    @DisplayName("a locality review keys on the slug, which is the localities primary key")
    void localityReviewsKeyOnSlug() throws Exception {
        User author = user("9820000018", "Rahul Joshi");
        String slug = jdbc.queryForObject(
                "select slug from localities order by slug limit 1", String.class);

        mvc.perform(post("/reviews/locality/" + slug)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON).content(body(3)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.targetId").value(slug));
    }

    @Test
    @DisplayName("entity reviews are also one-per-author")
    void entityReviewsAreAlsoOnePerAuthor() throws Exception {
        User author = user("9820000019", "Rahul Joshi");
        String slug = anySocietySlug();

        mvc.perform(post("/reviews/society/" + slug)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON).content(body(4)))
                .andExpect(status().isCreated());

        mvc.perform(post("/reviews/society/" + slug)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON).content(body(1)))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("posting an entity review requires a token")
    void entityReviewWriteRequiresAuth() throws Exception {
        mvc.perform(post("/reviews/society/" + anySocietySlug())
                        .contentType(MediaType.APPLICATION_JSON).content(body(4)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("the categories vocabulary is per target type, and is the one the UI renders")
    void categoryVocabularyMatchesTheUi() {
        assertThat(ReviewCategories.PROPERTY_KEYS)
                .as("RV_CATS in ReviewsSection.jsx — adding a key here without adding it there "
                        + "ships a sub-rating nothing displays")
                .containsExactlyInAnyOrder("locality", "condition", "value", "owner", "accuracy");

        assertThat(ReviewCategories.SOCIETY_KEYS)
                .as("REVIEW_CATS in pages/consumer/society/constants.js — these ids are what the "
                        + "hub's aspect bars are keyed on, capitalisation included; constants.js "
                        + "says renaming one orphans every stored rating")
                .containsExactlyInAnyOrder(
                        "Safety", "Maintenance", "Management", "Amenities", "Connectivity");

        // The two vocabularies are disjoint, which is why a shared key set could never have served
        // both: there is no aspect a listing and a housing society are both rated on.
        assertThat(ReviewCategories.PROPERTY_KEYS)
                .doesNotContainAnyElementsOf(ReviewCategories.SOCIETY_KEYS);

        // locality and owner keep the property vocabulary. Neither surface renders per-aspect bars
        // and nothing in the product names a vocabulary for them, so this is the status quo held
        // in place deliberately rather than a choice — see ReviewCategories' class Javadoc.
        assertThat(ReviewCategories.forTarget(ReviewTargetTypes.LOCALITY))
                .isEqualTo(ReviewCategories.PROPERTY_KEYS);
        assertThat(ReviewCategories.forTarget(ReviewTargetTypes.OWNER))
                .isEqualTo(ReviewCategories.PROPERTY_KEYS);
    }

    @Test
    @DisplayName("a society review carries the society aspects, and refuses the property ones")
    void societyReviewsUseTheSocietyVocabulary() throws Exception {
        User author = user("9820000030", "Rahul Joshi");
        String slug = anySocietySlug();

        mvc.perform(post("/reviews/society/" + slug)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":4,\"categories\":{\"Safety\":5,\"Connectivity\":3}}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.categories.Safety").value(5))
                .andExpect(jsonPath("$.categories.Connectivity").value(3))
                // Sparse: three aspects unanswered is a different review from five answered, and
                // the response has to keep them distinguishable.
                .andExpect(jsonPath("$.categories.Maintenance").doesNotExist())
                .andExpect(jsonPath("$.categories.length()").value(2));

        // `accuracy` is a perfectly good key — for a property. Refused here, not dropped: a 201
        // with the aspect silently gone is a write the caller believes worked and a bar that
        // stays empty forever.
        User other = user("9820000031", "Meera Kulkarni");
        mvc.perform(post("/reviews/society/" + slug)
                        .header(HttpHeaders.AUTHORIZATION, bearer(other))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":4,\"categories\":{\"accuracy\":5}}"))
                .andExpect(status().isBadRequest());

        // And the value range still applies to the new vocabulary — a second key set is a second
        // place for the bound to go missing.
        mvc.perform(post("/reviews/society/" + slug)
                        .header(HttpHeaders.AUTHORIZATION, bearer(other))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":4,\"categories\":{\"Safety\":9}}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("a property review refuses the society aspects — the split cuts both ways")
    void propertyReviewsRefuseTheSocietyVocabulary() throws Exception {
        User owner = user("9810000032", "Asha Patil");
        User visitor = user("9820000032", "Rahul Joshi");
        Property p = listing(owner);
        completedVisit(visitor, p);

        // The mirror of the assertion above, and the reason both are needed: a `forTarget` that
        // returned the union would pass the society test and this one would catch it.
        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":4,\"categories\":{\"Safety\":5}}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("a locality review keeps the property vocabulary it has always accepted")
    void localityReviewsKeepTheirVocabulary() throws Exception {
        User author = user("9820000033", "Rahul Joshi");
        // Its own locality rather than a seeded one: this asserts an exact stored value, and a
        // fixture shared with the rest of the suite would make that depend on reference data the
        // test does not own.
        String slug = "vocab-fixture-baner";
        jdbc.update("insert into localities (slug, name) values (?, ?)", slug, "Fixture Baner");

        // Nothing in the product names a vocabulary for a locality, so nothing here changed. This
        // is the regression guard on that non-decision.
        mvc.perform(post("/reviews/locality/" + slug)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":4,\"categories\":{\"locality\":5}}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.categories.locality").value(5));
    }

    // ----------------------------------------------------------------- helpers

    /** Any seeded society; the reference data ships 28 of them. */
    private String anySocietySlug() {
        return jdbc.queryForObject("select slug from societies order by slug limit 1", String.class);
    }
}
