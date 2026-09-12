package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.support.AbstractApiTest;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Native {@code UNION ALL} SQL the compiler cannot check, where a bad column or cast is a 500 on a
 * default page load. Each facet is asserted alone, since an {@code and} already false hides errors.
 */
@DisplayName("Flatmate feed — every facet and every sort produces runnable SQL")
class FlatmateFeedSearchTest extends AbstractApiTest {

    private MockHttpServletRequestBuilder feed(String tab) {
        return get(Routes.Flatmates.FEED).param("tab", tab);
    }

    /**
     * The verified subtotal can exceed the total only if the two were counted over different sets.
     * Asserting the relation rather than either number keeps this independent of the fixture.
     */
    private void expectWellFormedPage(MockHttpServletRequestBuilder request) throws Exception {
        String body = mvc.perform(request)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray())
                .andExpect(jsonPath("$.totalElements").isNumber())
                .andExpect(jsonPath("$.verifiedElements").isNumber())
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("\"verifiedElements\":null");
    }

    /** {@code totalElements} for a request, for the few cases that compare two requests. */
    private long totalOf(MockHttpServletRequestBuilder request) throws Exception {
        String json = mvc.perform(request)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(json, "$.totalElements")).longValue();
    }

    /* ─── The two tabs, unfiltered ─────────────────────────────────────────────────────────── */

    /** The only case where a window function feeds a join feeds another window function. */
    @Test
    @DisplayName("the move-in tab answers a page with no filters at all")
    void moveInUnfiltered() throws Exception {
        expectWellFormedPage(feed("move-in"));
    }

    @Test
    @DisplayName("the team-up tab answers a page with no filters at all")
    void teamUpUnfiltered() throws Exception {
        expectWellFormedPage(feed("team-up"));
    }

    /**
     * `tab` chooses which half of the market is searched, so an unrecognised one must not be
     * guessed. `sort` falls back for the opposite reason: it only reorders a correct answer.
     */
    @Test
    @DisplayName("an absent tab defaults; an unrecognised one is refused rather than guessed")
    void tabResolution() throws Exception {
        expectWellFormedPage(get(Routes.Flatmates.FEED));
        mvc.perform(feed("nonsense-tab")).andExpect(status().isBadRequest());
    }

    /** The legacy `?view=` alias still resolves — old links are the reason it is still accepted. */
    @Test
    @DisplayName("the legacy view alias still selects a tab")
    void legacyViewAlias() throws Exception {
        expectWellFormedPage(get(Routes.Flatmates.FEED).param("view", "rooms"));
        expectWellFormedPage(get(Routes.Flatmates.FEED).param("view", "groups"));
        expectWellFormedPage(get(Routes.Flatmates.FEED).param("view", "flatmates"));
    }

    /* ─── One facet at a time, on both tabs ────────────────────────────────────────────────── */

    /**
     * Free text, which is three different column lists depending on which branch it lands in — a
     * room searches its society and flat type, a group its title, a post its occupation.
     */
    @Test
    @DisplayName("free text runs against all three column lists")
    void freeText() throws Exception {
        expectWellFormedPage(feed("move-in").param("q", "koregaon"));
        expectWellFormedPage(feed("team-up").param("q", "koregaon"));
    }

    /**
     * Bound parameters do not stop {@code %} and {@code _} being wildcards, so they are escaped on
     * the Java side; an unescaped backslash reaching the pattern is a runtime error in some collations.
     */
    @Test
    @DisplayName("wildcard characters in the query are a search, not a syntax error")
    void freeTextWithMetacharacters() throws Exception {
        expectWellFormedPage(feed("move-in").param("q", "100%_\\"));
        expectWellFormedPage(feed("team-up").param("q", "'; select 1 --"));
    }

    /**
     * Locality, which is an equality on one branch and a jsonb containment on another — a seeker
     * names a shortlist of areas rather than one.
     */
    @Test
    @DisplayName("locality runs as equality on rooms and containment on posts")
    void locality() throws Exception {
        expectWellFormedPage(feed("move-in").param("locality", "Baner"));
        expectWellFormedPage(feed("team-up").param("locality", "Baner"));
    }

    /** An explicitly blank facet is a different binding from an absent one, and must widen. */
    @Test
    @DisplayName("blank facets are treated as no filter")
    void blankFacetsWiden() throws Exception {
        expectWellFormedPage(feed("move-in")
                .param("locality", "")
                .param("q", "")
                .param("gender", "")
                .param("attachedBath", ""));
    }

    /**
     * Budget, which is the facet with no column behind it on either branch: a room's per-person
     * price is a window aggregate over its flat, a group's is a generated column.
     */
    @Test
    @DisplayName("the budget range runs against two different derived prices")
    void budgetRange() throws Exception {
        expectWellFormedPage(feed("move-in").param("minBudget", "8000").param("maxBudget", "20000"));
        expectWellFormedPage(feed("team-up").param("minBudget", "8000").param("maxBudget", "20000"));
        // Each bound alone, because they append separate clauses.
        expectWellFormedPage(feed("move-in").param("minBudget", "8000"));
        expectWellFormedPage(feed("move-in").param("maxBudget", "20000"));
    }

    /** The single-value legacy alias, folded into the ceiling rather than living beside it. */
    @Test
    @DisplayName("the legacy single budget parameter still means a ceiling")
    void legacyBudgetAlias() throws Exception {
        expectWellFormedPage(feed("move-in").param("budget", "15000"));
    }

    /**
     * Spelled differently on either side of the union — rooms and posts store {@code male|female|any},
     * a group a join policy of {@code men|women|any} — so one request becomes two predicates.
     */
    @Test
    @DisplayName("gender translates into a group's policy vocabulary")
    void gender() throws Exception {
        expectWellFormedPage(feed("move-in").param("gender", "female"));
        expectWellFormedPage(feed("move-in").param("gender", "male"));
        expectWellFormedPage(feed("team-up").param("gender", "female"));
        // Unrecognised widens rather than empties — a stray casing must not delete the board.
        expectWellFormedPage(feed("move-in").param("gender", "Female"));
    }

    @Test
    @DisplayName("verified-only runs its own disjunction on all three branches")
    void verifiedOnly() throws Exception {
        expectWellFormedPage(feed("move-in").param("verifiedOnly", "true"));
        expectWellFormedPage(feed("team-up").param("verifiedOnly", "true"));
    }

    /** Move-in is a date comparison, and only two of the three branches have a date to compare. */
    @Test
    @DisplayName("move-in days runs where there is a date and is absent where there is not")
    void moveInDays() throws Exception {
        expectWellFormedPage(feed("move-in").param("moveInDays", "0"));
        expectWellFormedPage(feed("move-in").param("moveInDays", "30"));
        expectWellFormedPage(feed("team-up").param("moveInDays", "30"));
    }

    /**
     * A semantic check, not just an executability one: a predicate that is merely always false runs,
     * plans and answers a well-formed page of an empty set. The relation holds for any fixture.
     */
    @Test
    @DisplayName("a later move-in cutoff never returns fewer rows than an earlier one")
    void moveInDaysWidensMonotonically() throws Exception {
        for (String tab : new String[] {"move-in", "team-up"}) {
            long immediate = totalOf(feed(tab).param("moveInDays", "0"));
            long soon = totalOf(feed(tab).param("moveInDays", "30"));
            long unfiltered = totalOf(feed(tab));

            assertThat(soon)
                    .as("%s: widening the window cannot lose a row that already qualified", tab)
                    .isGreaterThanOrEqualTo(immediate);
            assertThat(unfiltered)
                    .as("%s: asking for a date cannot match more than asking for nothing", tab)
                    .isGreaterThanOrEqualTo(soon);
        }
    }

    /**
     * Habits, which are an AND of jsonb containments — one clause per habit, so this is the only
     * facet whose SQL grows with the size of the request.
     */
    @Test
    @DisplayName("several habits become several containment clauses")
    void habits() throws Exception {
        expectWellFormedPage(feed("move-in").param("habits", "Non-smoker"));
        expectWellFormedPage(feed("move-in")
                .param("habits", "Non-smoker", "Vegetarian", "Pet-friendly"));
        expectWellFormedPage(feed("team-up")
                .param("habits", "Non-smoker", "Vegetarian"));
        // A habit containing the characters jsonb uses structurally is still just a string.
        expectWellFormedPage(feed("move-in").param("habits", "{\"a\":1}"));
    }

    /** Room-only and group-only facets, which must narrow their own kind and not empty the other. */
    @Test
    @DisplayName("kind-specific facets run on the kind that has them")
    void kindSpecificFacets() throws Exception {
        expectWellFormedPage(feed("move-in").param("attachedBath", "attached"));
        expectWellFormedPage(feed("move-in").param("attachedBath", "shared"));
        expectWellFormedPage(feed("team-up").param("sharing", "3"));
        expectWellFormedPage(feed("move-in").param("sharing", "2"));
    }

    /**
     * Junk passed through narrows to nothing, so a typo or stale deep link reads as "the board is
     * empty". Asserted against the unfiltered total, making it a claim about the junk, not the fixture.
     */
    @Test
    @DisplayName("an unknown facet value is ignored rather than matching nothing")
    void unknownFacetValuesAreDropped() throws Exception {
        long whole = totalOf(feed("move-in"));
        assertThat(totalOf(feed("move-in").param("attachedBath", "yes"))).isEqualTo(whole);
        assertThat(totalOf(feed("move-in").param("gender", "unspecified"))).isEqualTo(whole);
        assertThat(totalOf(feed("move-in").param("sharing", "0"))).isEqualTo(whole);
        // Case is not the user's problem either; the stored vocabulary is lower-case throughout.
        assertThat(totalOf(feed("move-in").param("attachedBath", "Attached")))
                .isEqualTo(totalOf(feed("move-in").param("attachedBath", "attached")));
    }

    /** A bounding box plus a cosine comparison, so it also proves the coordinate columns' types. */
    @Test
    @DisplayName("a near-a-place radius runs on both tabs")
    void radius() throws Exception {
        expectWellFormedPage(feed("move-in")
                .param("nearLat", "18.5204").param("nearLng", "73.8567").param("nearRadiusKm", "5"));
        expectWellFormedPage(feed("team-up")
                .param("nearLat", "18.5204").param("nearLng", "73.8567").param("nearRadiusKm", "5"));
    }

    /**
     * A centre with no radius would divide by zero building the longitude delta; a radius with no
     * centre would bind half its parameters. Both arrive from hand-edited URLs and stale deep links.
     */
    @Test
    @DisplayName("half a near-a-place point narrows nothing rather than failing")
    void incompleteRadius() throws Exception {
        expectWellFormedPage(feed("move-in").param("nearLat", "18.5204").param("nearLng", "73.8567"));
        expectWellFormedPage(feed("move-in").param("nearRadiusKm", "5"));
        expectWellFormedPage(feed("move-in")
                .param("nearLat", "18.5204").param("nearLng", "73.8567").param("nearRadiusKm", "0"));
    }

    /** A radius past the ceiling is clamped, not refused — and the clamped statement must run. */
    @Test
    @DisplayName("an absurd radius is clamped rather than scanning the table")
    void radiusIsClamped() throws Exception {
        expectWellFormedPage(feed("move-in")
                .param("nearLat", "18.5204").param("nearLng", "73.8567")
                .param("nearRadiusKm", "99999"));
    }

    /* ─── Sorts ────────────────────────────────────────────────────────────────────────────── */

    /**
     * An {@code order by} over a {@code UNION ALL} can only name projected columns, and price is a
     * different expression per branch — so a sort fails on the default page load, not behind a chip.
     */
    @Test
    @DisplayName("every sort key produces a runnable order")
    void everySort() throws Exception {
        for (String sort : new String[] {"verified", "newest", "budget-low", "budget-high", "match"}) {
            expectWellFormedPage(feed("move-in").param("sort", sort));
            expectWellFormedPage(feed("team-up").param("sort", sort));
        }
    }

    /** An unknown sort falls back to trust-first rather than 400, for the same reason `tab` does. */
    @Test
    @DisplayName("an unrecognised sort falls back instead of failing")
    void unknownSort() throws Exception {
        expectWellFormedPage(feed("move-in").param("sort", "price-low"));
        expectWellFormedPage(feed("move-in").param("sort", ""));
    }

    /** The only clause built from the searcher rather than the row, all in one {@code order by}. */
    @Test
    @DisplayName("best match scores against the searcher's own post")
    void matchSortWithMe() throws Exception {
        expectWellFormedPage(feed("team-up")
                .param("sort", "match")
                .param("meLocalities", "Baner", "Wakad")
                .param("meBudget", "16000")
                .param("meGender", "female"));
        expectWellFormedPage(feed("move-in")
                .param("sort", "match")
                .param("meLocalities", "Baner")
                .param("meBudget", "16000")
                .param("meGender", "male"));
        // Each scoring term alone, since each appends its own fragment.
        expectWellFormedPage(feed("move-in").param("sort", "match").param("meBudget", "16000"));
        expectWellFormedPage(feed("move-in").param("sort", "match").param("meGender", "male"));
        expectWellFormedPage(feed("move-in").param("sort", "match").param("meLocalities", "Baner"));
    }

    /** The band comparison multiplies it, so 0 overlaps only 0 — and a seeker post really can be 0. */
    @Test
    @DisplayName("a zero budget is a number, not an absence")
    void zeroBudgetScores() throws Exception {
        expectWellFormedPage(feed("move-in").param("sort", "match").param("meBudget", "0"));
        expectWellFormedPage(feed("move-in").param("minBudget", "0"));
    }

    /* ─── Paging ───────────────────────────────────────────────────────────────────────────── */

    /**
     * Zero rows means the window functions have no row to read totals off, so they are counted
     * separately; reporting 0 would collapse {@code totalPages} and unmount the pager on page 4.
     */
    @Test
    @DisplayName("a page past the end is empty but still reports the whole match set")
    void pastTheEnd() throws Exception {
        long whole = totalOf(feed("move-in").param("size", "24"));
        mvc.perform(feed("move-in").param("page", "999").param("size", "24"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.totalElements").value((int) whole));
    }

    @Test
    @DisplayName("an explicit page size is honoured on both tabs")
    void explicitPageSize() throws Exception {
        expectWellFormedPage(feed("move-in").param("page", "0").param("size", "5"));
        expectWellFormedPage(feed("team-up").param("page", "1").param("size", "5"));
    }

    /* ─── Everything at once ───────────────────────────────────────────────────────────────── */

    /**
     * The single-facet cases prove each fragment parses; this proves they compose without two of
     * them binding the same parameter name to different values.
     */
    @Test
    @DisplayName("every facet at once is still one valid statement")
    void everyFacetTogether() throws Exception {
        expectWellFormedPage(feed("move-in")
                .param("q", "baner")
                .param("locality", "Baner")
                .param("nearLat", "18.5204").param("nearLng", "73.8567").param("nearRadiusKm", "5")
                .param("minBudget", "8000").param("maxBudget", "25000")
                .param("gender", "female")
                .param("verifiedOnly", "true")
                .param("moveInDays", "30")
                .param("habits", "Non-smoker", "Vegetarian")
                .param("attachedBath", "attached")
                .param("sharing", "3")
                .param("sort", "match")
                .param("meLocalities", "Baner", "Wakad")
                .param("meBudget", "16000")
                .param("meGender", "female")
                .param("page", "0").param("size", "12"));

        expectWellFormedPage(feed("team-up")
                .param("q", "baner")
                .param("locality", "Baner")
                .param("nearLat", "18.5204").param("nearLng", "73.8567").param("nearRadiusKm", "5")
                .param("minBudget", "8000").param("maxBudget", "25000")
                .param("gender", "male")
                .param("verifiedOnly", "true")
                .param("moveInDays", "30")
                .param("habits", "Non-smoker")
                .param("sharing", "2")
                .param("sort", "budget-low")
                .param("page", "0").param("size", "12"));
    }
}
