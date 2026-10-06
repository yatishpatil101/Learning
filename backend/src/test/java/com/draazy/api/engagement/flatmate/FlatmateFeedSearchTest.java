package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.support.AbstractApiTest;
import com.jayway.jsonpath.JsonPath;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** Native {@code UNION ALL} SQL the compiler can't check: a bad column or cast is a 500 on a default page load.
 * Each facet is asserted alone, since an {@code and} already false hides errors. */
@DisplayName("Flatmate feed — every facet and every sort produces runnable SQL")
class FlatmateFeedSearchTest extends AbstractApiTest {

    private static MockHttpServletRequestBuilder feed(String tab) {
        return get(Routes.Flatmates.FEED).param("tab", tab);
    }

    private static Arguments smoke(String name, MockHttpServletRequestBuilder... requests) {
        return Arguments.of(name, requests);
    }

    /** Verified subtotal > total only if counted over different sets; asserting the relation is fixture-free. */
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

    private static Stream<Arguments> smokeCases() {
        return Stream.of(
                // The only case where a window function feeds a join feeds another window function.
                smoke("moveInUnfiltered", feed("move-in")),
                smoke("teamUpUnfiltered", feed("team-up")),
                // Old links are the reason the legacy `?view=` alias is still accepted.
                smoke("legacyViewAlias",
                        get(Routes.Flatmates.FEED).param("view", "rooms"),
                        get(Routes.Flatmates.FEED).param("view", "groups"),
                        get(Routes.Flatmates.FEED).param("view", "flatmates")),
                // Three different column lists depending on the branch: a room searches its society
                // and flat type, a group its title, a post its occupation.
                smoke("freeText",
                        feed("move-in").param("q", "koregaon"),
                        feed("team-up").param("q", "koregaon")),
                // %, _ and backslash are escaped Java-side; a raw backslash errors in some collations.
                smoke("freeTextWithMetacharacters",
                        feed("move-in").param("q", "100%_\\"),
                        feed("team-up").param("q", "'; select 1 --")),
                // Equality on one branch, jsonb containment on another.
                smoke("locality",
                        feed("move-in").param("locality", "Baner"),
                        feed("team-up").param("locality", "Baner")),
                // An explicitly blank facet is a different binding from an absent one, and must widen.
                smoke("blankFacetsWiden",
                        feed("move-in")
                                .param("locality", "")
                                .param("q", "")
                                .param("gender", "")
                                .param("attachedBath", "")),
                // No column behind it on either branch: a window aggregate on rooms, a generated
                // column on groups. Each bound alone, because they append separate clauses.
                smoke("budgetRange",
                        feed("move-in").param("minBudget", "8000").param("maxBudget", "20000"),
                        feed("team-up").param("minBudget", "8000").param("maxBudget", "20000"),
                        feed("move-in").param("minBudget", "8000"),
                        feed("move-in").param("maxBudget", "20000")),
                smoke("legacyBudgetAlias", feed("move-in").param("budget", "15000")),
                // Rooms and posts store male|female|any, a group men|women|any; an unrecognised
                // casing widens rather than emptying the board.
                smoke("gender",
                        feed("move-in").param("gender", "female"),
                        feed("move-in").param("gender", "male"),
                        feed("team-up").param("gender", "female"),
                        feed("move-in").param("gender", "Female")),
                smoke("verifiedOnly",
                        feed("move-in").param("verifiedOnly", "true"),
                        feed("team-up").param("verifiedOnly", "true")),
                // A date comparison; only two of the three branches have a date.
                smoke("moveInDays",
                        feed("move-in").param("moveInDays", "0"),
                        feed("move-in").param("moveInDays", "30"),
                        feed("team-up").param("moveInDays", "30")),
                // One jsonb containment clause per habit, so the SQL grows with the request; a
                // habit holding jsonb's structural characters is still just a string.
                smoke("habits",
                        feed("move-in").param("habits", "Non-smoker"),
                        feed("move-in").param("habits", "Non-smoker", "Vegetarian", "Pet-friendly"),
                        feed("team-up").param("habits", "Non-smoker", "Vegetarian"),
                        feed("move-in").param("habits", "{\"a\":1}")),
                // Room-only and group-only facets must narrow their own kind and not empty the other.
                smoke("kindSpecificFacets",
                        feed("move-in").param("attachedBath", "attached"),
                        feed("move-in").param("attachedBath", "shared"),
                        feed("team-up").param("sharing", "3"),
                        feed("move-in").param("sharing", "2")),
                // A bounding box plus a cosine comparison, so it proves the coordinate column types.
                smoke("radius",
                        feed("move-in").param("nearLat", "18.5204").param("nearLng", "73.8567")
                                .param("nearRadiusKm", "5"),
                        feed("team-up").param("nearLat", "18.5204").param("nearLng", "73.8567")
                                .param("nearRadiusKm", "5")),
                // A centre with no radius would divide by zero; a radius with no centre would bind
                // half its parameters. Both arrive from hand-edited URLs and stale deep links.
                smoke("incompleteRadius",
                        feed("move-in").param("nearLat", "18.5204").param("nearLng", "73.8567"),
                        feed("move-in").param("nearRadiusKm", "5"),
                        feed("move-in").param("nearLat", "18.5204").param("nearLng", "73.8567")
                                .param("nearRadiusKm", "0")),
                // Past the ceiling the radius is clamped, not refused, and the statement must run.
                smoke("radiusIsClamped",
                        feed("move-in").param("nearLat", "18.5204").param("nearLng", "73.8567")
                                .param("nearRadiusKm", "99999")),
                // An order by over a UNION ALL can only name projected columns and price differs
                // per branch, so a bad sort fails on the default page load.
                smoke("everySort",
                        feed("move-in").param("sort", "verified"),
                        feed("team-up").param("sort", "verified"),
                        feed("move-in").param("sort", "newest"),
                        feed("team-up").param("sort", "newest"),
                        feed("move-in").param("sort", "budget-low"),
                        feed("team-up").param("sort", "budget-low"),
                        feed("move-in").param("sort", "budget-high"),
                        feed("team-up").param("sort", "budget-high"),
                        feed("move-in").param("sort", "match"),
                        feed("team-up").param("sort", "match")),
                // An unknown sort falls back to trust-first rather than 400, unlike `tab`.
                smoke("unknownSort",
                        feed("move-in").param("sort", "price-low"),
                        feed("move-in").param("sort", "")),
                // The only clause built from the searcher rather than the row; each scoring term
                // alone, since each appends its own fragment.
                smoke("matchSortWithMe",
                        feed("team-up")
                                .param("sort", "match")
                                .param("meLocalities", "Baner", "Wakad")
                                .param("meBudget", "16000")
                                .param("meGender", "female"),
                        feed("move-in")
                                .param("sort", "match")
                                .param("meLocalities", "Baner")
                                .param("meBudget", "16000")
                                .param("meGender", "male"),
                        feed("move-in").param("sort", "match").param("meBudget", "16000"),
                        feed("move-in").param("sort", "match").param("meGender", "male"),
                        feed("move-in").param("sort", "match").param("meLocalities", "Baner")),
                // The band comparison multiplies it, so 0 overlaps only 0; a seeker post can be 0.
                smoke("zeroBudgetScores",
                        feed("move-in").param("sort", "match").param("meBudget", "0"),
                        feed("move-in").param("minBudget", "0")),
                smoke("explicitPageSize",
                        feed("move-in").param("page", "0").param("size", "5"),
                        feed("team-up").param("page", "1").param("size", "5")),
                // The single-facet cases prove each fragment parses; this proves they compose
                // without two of them binding the same parameter name to different values.
                smoke("everyFacetTogether",
                        feed("move-in")
                                .param("q", "baner")
                                .param("locality", "Baner")
                                .param("nearLat", "18.5204").param("nearLng", "73.8567")
                                .param("nearRadiusKm", "5")
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
                                .param("page", "0").param("size", "12"),
                        feed("team-up")
                                .param("q", "baner")
                                .param("locality", "Baner")
                                .param("nearLat", "18.5204").param("nearLng", "73.8567")
                                .param("nearRadiusKm", "5")
                                .param("minBudget", "8000").param("maxBudget", "25000")
                                .param("gender", "male")
                                .param("verifiedOnly", "true")
                                .param("moveInDays", "30")
                                .param("habits", "Non-smoker")
                                .param("sharing", "2")
                                .param("sort", "budget-low")
                                .param("page", "0").param("size", "12")));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("smokeCases")
    @DisplayName("each facet and sort runs as a well-formed page")
    void facetRunsAsWellFormedPage(String name, MockHttpServletRequestBuilder[] requests)
            throws Exception {
        for (MockHttpServletRequestBuilder request : requests) {
            expectWellFormedPage(request);
        }
    }

    /** `tab` picks which half of the market is searched, so unknowns aren't guessed; `sort` only reorders. */
    @Test
    @DisplayName("an absent tab defaults; an unrecognised one is refused rather than guessed")
    void tabResolution() throws Exception {
        expectWellFormedPage(get(Routes.Flatmates.FEED));
        mvc.perform(feed("nonsense-tab")).andExpect(status().isBadRequest());
    }

    /** Semantic, not just executable: an always-false predicate still plans and returns an empty page. */
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

    /** Junk must not narrow to nothing, or a typo or stale deep link reads as "the board is empty". */
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

    /** With zero rows the window functions can't read totals, so count separately; 0 would unmount the pager. */
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
    @DisplayName("each tab reports the other tab's total under the same facets")
    void otherTabTotalMatchesTheOtherTab() throws Exception {
        for (String[] pair : new String[][] {{"move-in", "team-up"}, {"team-up", "move-in"}}) {
            String json = mvc.perform(feed(pair[0]).param("verifiedOnly", "true").param("size", "1"))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            long other = ((Number) JsonPath.read(json, "$.otherTabElements")).longValue();
            assertThat(other).as(pair[0]).isEqualTo(totalOf(feed(pair[1]).param("verifiedOnly", "true")));
        }
    }
}
