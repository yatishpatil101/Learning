package com.draazy.api.catalog.society;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.engagement.review.ReviewStatuses;
import com.draazy.api.engagement.review.ReviewTargetTypes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import com.jayway.jsonpath.JsonPath;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MvcResult;

/** Each filter and sort must hold over the whole set, since the directory pages one page at a time. */
@DisplayName("Societies — the paged directory read")
class SocietyDirectoryPagingTest extends AbstractApiTest {

    private static final String FIXTURES = "q=zz socpage";

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    private User user;

    /** Names sort after every seeded society, so a sort that only ordered a page could never put them first. */
    private void fixtures() {
        user = new User("9865200001", "owner");
        user.setName("Asha Patil");
        user.setMobileVerified(true);
        user = users.saveAndFlush(user);

        society("alpha", "rera", true, false);
        UUID bravo = society("bravo", "rera", false, false);
        UUID charlie = society("charlie", "community", false, false);
        UUID delta = society("delta", "rera", true, false);
        UUID echo = society("echo", "community", false, true);
        society("foxtrot", "community", true, false);
        UUID annexe = society("delta-annexe", "rera", false, false);
        jdbc.update("update societies set merged_into = ?, merged_at = now(), merged_by = ? where id = ?",
                delta, user.getId(), annexe);

        listings(bravo, 3);
        listings(charlie, 2);
        listings(delta, 1);
        listings(annexe, 2);

        reviews(bravo, 4, 4);
        reviews(charlie, 5);
        reviews(delta, 5, 5);
        reviews(echo, 5);
    }

    private UUID society(String key, String source, boolean documents, boolean opsVerified) {
        String slug = "zz-socpage-" + key;
        jdbc.update("insert into societies (slug, name, locality_slug, source, registration, conveyance) "
                + "values (?, ?, 'kharadi', ?, ?, ?)",
                slug, "Zz Socpage " + key.replace('-', ' '), source, documents, documents);
        if (opsVerified) {
            jdbc.update("update societies set verified_at = now(), verified_by = ? where slug = ?",
                    user.getId(), slug);
        }
        return jdbc.queryForObject("select id from societies where slug = ?", UUID.class, slug);
    }

    private void listings(UUID societyId, int count) {
        for (int i = 0; i < count; i++) {
            Property p = new Property(user, "Home " + i, "rent", "apartment", 25000L, "Kharadi", "Pune");
            p.setBhk(new BigDecimal("2"));
            p.setPriceUnit("per-month");
            p.setArea(new BigDecimal("1000"));
            p.setLocalitySlug("kharadi");
            p.setSocietyId(societyId);
            p.setStatus("approved");
            properties.saveAndFlush(p);
        }
    }

    private void reviews(UUID societyId, int... ratings) {
        for (int rating : ratings) {
            jdbc.update("insert into reviews (target_type, target_id, rating, status, categories) "
                            + "values (?, ?, ?, ?, cast(? as jsonb))",
                    ReviewTargetTypes.SOCIETY, societyId.toString(), rating, ReviewStatuses.PUBLISHED,
                    "{\"Safety\":" + rating + "}");
        }
    }

    private static String[] slugs(String... keys) {
        return Arrays.stream(keys).map(k -> "zz-socpage-" + k).toArray(String[]::new);
    }

    /** Every page of a query, {@code size} rows at a time, in the order the server gave them. */
    private List<String> walk(String query, int size) throws Exception {
        List<String> all = new ArrayList<>();
        for (int page = 0; page < 10; page++) {
            MvcResult res = mvc.perform(get("/societies?" + query + "&size=" + size + "&page=" + page))
                    .andExpect(status().isOk()).andReturn();
            List<String> got = JsonPath.read(res.getResponse().getContentAsString(), "$.content[*].slug");
            if (got.isEmpty()) {
                break;
            }
            all.addAll(got);
        }
        return all;
    }

    private int count(String where) {
        return jdbc.queryForObject("select count(*) from societies where merged_into is null and " + where,
                Integer.class);
    }

    @Test
    @DisplayName("name paging walks every twin once, however the page boundary falls between them")
    void nameSortPagesThroughTiedNames() throws Exception {
        for (String key : List.of("c", "a", "d", "b")) {
            jdbc.update("insert into societies (slug, name, locality_slug, source) "
                    + "values (?, 'Zz Socpage Twin', 'kharadi', 'rera')", "zz-socpage-twin-" + key);
        }

        assertThat(walk("q=zz socpage twin&sort=name", 1)).containsExactly(
                slugs("twin-a", "twin-b", "twin-c", "twin-d"));
    }

    @Test
    @DisplayName("homes ranks the whole directory, counting a merged-away duplicate's listings")
    void homesSortsTheWholeSetAcrossPages() throws Exception {
        fixtures();

        // Delta (3 with its annexe, verified) ties Bravo (3) and wins on the badge, then Charlie (2);
        // the rest have none and fall back to verified-first, then name.
        assertThat(walk(FIXTURES + "&sort=homes", 2)).containsExactly(
                slugs("delta", "bravo", "charlie", "alpha", "echo", "foxtrot"));

        // None of them is on the first page of an alphabetical read of the whole directory.
        mvc.perform(get("/societies?sort=homes&size=2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].slug").value(contains(slugs("delta", "bravo"))))
                .andExpect(jsonPath("$.content[0].listingCount").value(3))
                .andExpect(jsonPath("$.sort").value("homes,desc"))
                .andExpect(jsonPath("$.totalElements").value(count("true")));
    }

    @Test
    @DisplayName("rating ranks by average, then review count, then name — unrated last")
    void ratingSortsTheWholeSetAcrossPages() throws Exception {
        fixtures();

        assertThat(walk(FIXTURES + "&sort=rating", 2)).containsExactly(
                slugs("delta", "charlie", "echo", "bravo", "alpha", "foxtrot"));

        mvc.perform(get("/societies?sort=rating&size=1"))
                .andExpect(jsonPath("$.content[0].slug").value("zz-socpage-delta"))
                .andExpect(jsonPath("$.content[0].reviewCount").value(2));
    }

    @Test
    @DisplayName("relevance is verified*4 + min(homes,3) + average/5, name breaking ties")
    void relevanceSortsTheWholeSetAcrossPages() throws Exception {
        fixtures();

        // Delta 4+3+1, Echo 4+0+1, Alpha 4, Bravo 0+3+.8, Charlie 0+2+1, Foxtrot 0.
        assertThat(walk(FIXTURES + "&sort=relevance", 2)).containsExactly(
                slugs("delta", "echo", "alpha", "bravo", "charlie", "foxtrot"));

        mvc.perform(get("/societies?sort=relevance&size=1"))
                .andExpect(jsonPath("$.content[0].slug").value("zz-socpage-delta"));
    }

    @Test
    @DisplayName("a ranked sort is applied over the filtered set")
    void rankedSortsComposeWithFilters() throws Exception {
        fixtures();

        assertThat(walk(FIXTURES + "&verified=true&sort=relevance", 2)).containsExactly(
                slugs("delta", "echo", "alpha"));

        mvc.perform(get("/societies?locality=kharadi&sort=homes&size=100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].localitySlug").value(everyItem(is("kharadi"))))
                .andExpect(jsonPath("$.totalElements").value(count("locality_slug = 'kharadi'")));
    }

    @Test
    @DisplayName("verified=true keeps what the card badges verified: ops-confirmed, or non-community with both documents")
    void verifiedFilterMatchesTheBadge() throws Exception {
        fixtures();

        mvc.perform(get("/societies?" + FIXTURES + "&verified=true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].slug").value(contains(slugs("alpha", "delta", "echo"))));

        mvc.perform(get("/societies?verified=true&size=100"))
                .andExpect(jsonPath("$.totalElements").value(count(
                        "(verified_at is not null or (coalesce(source, '') <> 'community' "
                                + "and registration and conveyance))")));
    }

    @Test
    @DisplayName("without the new params the read is the alphabetical directory it always was")
    void defaultsAreUnchanged() throws Exception {
        fixtures();
        int total = count("true");

        mvc.perform(get("/societies"))
                .andExpect(jsonPath("$.totalElements").value(total))
                .andExpect(jsonPath("$.sort").value("name,asc"));
        mvc.perform(get("/societies?verified=false"))
                .andExpect(jsonPath("$.totalElements").value(total));
        mvc.perform(get("/societies?sort=name&size=100"))
                .andExpect(jsonPath("$.sort").value("name,asc"));
        mvc.perform(get("/societies?sort=claimStatus,desc"))
                .andExpect(jsonPath("$.sort").value("name,asc"));
    }

    @Test
    @DisplayName("q matches the name, the builder and the locality's words")
    void queryMatchesNameBuilderAndLocality() throws Exception {
        int namedKharadi = jdbc.queryForObject(
                "select count(*) from societies where lower(name) like '%kharadi%' "
                        + "or lower(builder) like '%kharadi%'", Integer.class);

        mvc.perform(get("/societies?q=kharadi&size=100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(
                        count("lower(name || ' ' || coalesce(builder, '') || ' ' "
                                + "|| replace(coalesce(locality_slug, ''), '-', ' ')) like '%kharadi%'")))
                .andExpect(jsonPath("$.totalElements").value(greaterThan(namedKharadi)));

        // The slug is hyphenated, the typed words are not.
        mvc.perform(get("/societies?q=koregaon park&size=100"))
                .andExpect(jsonPath("$.totalElements").value(greaterThan(0)))
                .andExpect(jsonPath("$.content[*].localitySlug").value(hasItem("koregaon-park")));

        mvc.perform(get("/societies?q=godrej"))
                .andExpect(jsonPath("$.content[0].builder")
                        .value(org.hamcrest.Matchers.containsStringIgnoringCase("godrej")));
    }
}
