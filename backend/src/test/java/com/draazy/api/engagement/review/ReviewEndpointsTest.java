package com.draazy.api.engagement.review;

import com.draazy.api.support.AbstractApiTest;
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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/** Runs on the live Flyway'd Postgres so V16's UNIQUE index is real. The risk here is unearned writes, so the key
 * assertions are the eligibility refusals, the derived (not supplied) badge, and one review per author. */
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

    @ParameterizedTest(name = "{0}")
    @DisplayName("an unknown target is 404, not an empty page or a new target kind")
    @CsvSource(delimiter = '|', value = {
            "unknown entity slug | /reviews/society/no-such-society-anywhere",
            "unknown entity type | /reviews/banana/whatever",
            "unknown property | /properties/00000000-0000-0000-0000-000000000000/reviews"
    })
    void unknownTargetIs404(String label, String path) throws Exception {
        mvc.perform(get(path))
                .andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------ eligibility

    @ParameterizedTest(name = "{0}")
    @DisplayName("without a completed visit or a tenancy, or as the owner, a listing cannot be reviewed")
    @ValueSource(strings = {"stranger", "owner-who-visited", "scheduled-not-completed-visit"})
    void ineligibleAuthorsCannotReview(String scenario) throws Exception {
        User owner = user("9810000002", "Asha Patil");
        User author = "owner-who-visited".equals(scenario) ? owner : user("9820000002", "Rahul Joshi");
        Property p = listing(owner);
        if ("owner-who-visited".equals(scenario)) {
            completedVisit(owner, p);
        }
        if ("scheduled-not-completed-visit".equals(scenario)) {
            Visit v = new Visit(p.getId(), author.getId(),
                    Instant.now().plus(2, ChronoUnit.DAYS), "in-person", null);
            v.setStatus(VisitStatuses.SCHEDULED);
            visits.saveAndFlush(v);
        }

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON).content(body(5)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error").value("review_not_eligible"));
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("anonymous cannot post a review")
    @ValueSource(strings = {"property", "society"})
    void anonymousCannotReview(String target) throws Exception {
        User owner = user("9810000005", "Asha Patil");
        Property p = listing(owner);
        String path = "property".equals(target)
                ? "/properties/" + p.getId() + "/reviews"
                : "/reviews/society/" + anySocietySlug();

        mvc.perform(post(path)
                        .contentType(MediaType.APPLICATION_JSON).content(body(4)))
                .andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------- the derived badge

    @ParameterizedTest(name = "{0}")
    @DisplayName("the badge is derived server-side: tenancy outranks a visit and a supplied context is ignored")
    @CsvSource(delimiter = '|', value = {
            "completed visit earns the visit badge | true | NONE | NONE | visit",
            "a tenancy outranks a visit | true | active | NONE | tenant",
            "an ended tenancy still earns the resident badge | false | ended | NONE | tenant",
            "a client-supplied context is ignored | true | NONE | tenant | visit"
    })
    void contextIsDerivedNotSupplied(String label, boolean visited, String tenancyStatus,
            String suppliedContext, String expected) throws Exception {
        User owner = user("9810000006", "Asha Patil");
        User author = user("9820000006", "Rahul Joshi");
        Property p = listing(owner);
        if (visited) {
            completedVisit(author, p);
        }
        if (!"NONE".equals(tenancyStatus)) {
            tenancy(author, p, tenancyStatus);
        }
        String content = "NONE".equals(suppliedContext)
                ? body(4)
                : "{\"rating\":5,\"context\":\"" + suppliedContext + "\"}";

        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON).content(content))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.context").value(expected))
                .andExpect(jsonPath("$.author").value("Rahul Joshi"))
                .andExpect(jsonPath("$.targetType").value("property"));
    }

    // --------------------------------------------------------- one per author

    @ParameterizedTest(name = "{0}")
    @DisplayName("a second review of the same target by the same author is refused")
    @ValueSource(strings = {"property", "society"})
    void oneReviewPerAuthorPerTarget(String target) throws Exception {
        User author = user("9820000010", "Rahul Joshi");
        String path;
        if ("property".equals(target)) {
            Property p = listing(user("9810000010", "Asha Patil"));
            completedVisit(author, p);
            path = "/properties/" + p.getId() + "/reviews";
        } else {
            path = "/reviews/society/" + anySocietySlug();
        }

        mvc.perform(post(path)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON).content(body(5)))
                .andExpect(status().isCreated());

        mvc.perform(post(path)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
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
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].rating").value(5))
                .andExpect(jsonPath("$.summary.reviewCount").value(1));
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

    @ParameterizedTest(name = "{0}")
    @DisplayName("society rating aggregates are computed not stored, and hub and directory agree")
    @ValueSource(strings = {"hub", "directory"})
    void societyRatingIsComputed(String surface) throws Exception {
        String slug = anySocietySlug();
        String id = jdbc.queryForObject(
                "select id::text from societies where slug = ?", String.class, slug);
        // `q` searches name and builder, not the slug — searching by slug here would silently match
        // nothing and the assertions would run against an empty page.
        String name = jdbc.queryForObject(
                "select name from societies where slug = ?", String.class, slug);
        boolean hub = "hub".equals(surface);
        String root = hub ? "$" : "$.content[0]";

        // Unrated: absent, not zero. A card that renders 0.0 for an unreviewed society is stating
        // something false about it, so the aggregate has to be able to say "no opinion yet".
        mvc.perform(hub ? get("/societies/" + slug) : get("/societies").param("q", name))
                .andExpect(status().isOk())
                .andExpect(jsonPath(root + ".reviewCount").value(0))
                .andExpect(jsonPath(root + ".avgRating").doesNotExist());

        jdbc.update("insert into reviews (target_type, target_id, rating, status) "
                + "values ('society', ?, 5, 'published')", id);
        jdbc.update("insert into reviews (target_type, target_id, rating, status) "
                + "values ('society', ?, 4, 'published')", id);
        // A rejected review must not move the average.
        jdbc.update("insert into reviews (target_type, target_id, rating, status) "
                + "values ('society', ?, 1, 'rejected')", id);

        mvc.perform(hub ? get("/societies/" + slug) : get("/societies").param("q", name))
                .andExpect(status().isOk())
                .andExpect(jsonPath(root + ".reviewCount").value(2))
                .andExpect(jsonPath(root + ".avgRating").value(4.5));
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

        // `accuracy` is a property key: refused, not dropped, since a 201 with the aspect gone misleads.
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
    @DisplayName("a locality review keys on the slug and keeps the property vocabulary it has always accepted")
    void localityReviewsKeepTheirVocabulary() throws Exception {
        User author = user("9820000033", "Rahul Joshi");
        // Own locality, not a seeded one: an exact stored value must not depend on data the test doesn't own.
        String slug = "vocab-fixture-baner";
        jdbc.update("insert into localities (slug, name) values (?, ?)", slug, "Fixture Baner");

        // Nothing in the product names a vocabulary for a locality, so nothing here changed. This
        // is the regression guard on that non-decision.
        mvc.perform(post("/reviews/locality/" + slug)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":4,\"categories\":{\"locality\":5}}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.targetId").value(slug))
                .andExpect(jsonPath("$.categories.locality").value(5));
    }

    // ----------------------------------------------------------------- helpers

    /** Any seeded society; the reference data ships 28 of them. */
    private String anySocietySlug() {
        return jdbc.queryForObject("select slug from societies order by slug limit 1", String.class);
    }
}
