package com.draazy.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.engagement.search.SavedSearch;
import com.draazy.api.engagement.search.SavedSearchCreateRequest;
import com.draazy.api.engagement.search.SavedSearchRepository;
import com.draazy.api.engagement.search.SavedSearchResponse;
import com.draazy.api.engagement.search.SavedSearchService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;

// ? a saved search reports how many listings match it, counted by the server.
// The absurd BHK fixture makes assertions exact, not "greater than existing fixtures".
@DisplayName("Saved searches — how many listings match this alert, counted server-side")
class SavedSearchMatchCountTest extends AbstractApiTest {

    private static final String SLUG = "d227-match-count";
    private static final String NAME = "D227 Match Count";

    @Autowired
    SavedSearchService savedSearches;

    @Autowired
    SavedSearchRepository searches;

    @Autowired
    UserRepository users;

    @Autowired
    PropertyRepository properties;

    @Autowired
    EntityManager em;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Owner " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private void seedLocality() {
        seedLocality(SLUG, NAME);
    }

    private void seedLocality(String slug, String name) {
        jdbc.update("""
                insert into localities (slug, name, city, active)
                values (?, ?, ?, true)
                on conflict (slug) do nothing
                """, slug, name, "Pune");
    }

    private SavedSearch alert(User user, String filters) {
        SavedSearch search = new SavedSearch(user.getId(), "rent " + SLUG);
        search.setFilters(filters);
        return searches.saveAndFlush(search);
    }

    private Property listing(User owner, String title, String deal, String bhk, String status) {
        return listing(owner, title, deal, "apartment", 31000L, bhk, status);
    }

    private Property listing(User owner, String title, String deal, String type, long price,
            String bhk, String status) {
        Property p = new Property(owner, title, deal, type, price, NAME, "Pune");
        p.setLocalitySlug(SLUG);
        p.setBhk(new BigDecimal(bhk));
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }

    private SavedSearchResponse only(User user) {
        List<SavedSearchResponse> rows = savedSearches.list(user.getId());
        assertThat(rows).hasSize(1);
        return rows.get(0);
    }

    @Test
    @DisplayName("counts every live match, however old — this is a total, not a delta")
    void countsMatchesRegardlessOfAge() {
        User user = owner("9820600001");
        seedLocality();
        alert(user,
                "{\"deal\":\"rent\",\"localities\":[\"" + SLUG + "\"],\"bhk\":[99]}");

        Property ancient = listing(user, "Old 99BHK", "rent", "99", "approved");
        listing(user, "New 99BHK", "rent", "99", "approved");

        // Push one of them well before any plausible sweep baseline. newCount would exclude it;
        // matchCount is the answer to a different question and must not.
        jdbc.update("update properties set created_at = ? where id = ?",
                Timestamp.from(Instant.now().minusSeconds(86_400 * 30)), ancient.getId());
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isEqualTo(2);
        assertThat(only(user).newCount()).isZero();
    }

    @Test
    @DisplayName("only approved, unarchived listings count")
    void ignoresListingsNobodyCanSee() {
        User user = owner("9820600002");
        seedLocality();
        alert(user, "{\"deal\":\"rent\",\"localities\":[\"" + SLUG + "\"],\"bhk\":[99]}");

        listing(user, "Live 99BHK", "rent", "99", "approved");
        listing(user, "Pending 99BHK", "rent", "99", "pending");
        listing(user, "Rejected 99BHK", "rent", "99", "rejected");
        Property archived = listing(user, "Archived 99BHK", "rent", "99", "approved");
        archived.archive("owner took it down");
        properties.saveAndFlush(archived);
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("every facet narrows: a listing must match deal, locality and BHK together")
    void everyFacetNarrows() {
        User user = owner("9820600003");
        seedLocality();
        alert(user, "{\"deal\":\"rent\",\"localities\":[\"" + SLUG + "\"],\"bhk\":[99]}");

        listing(user, "The one", "rent", "99", "approved");
        listing(user, "Wrong deal", "buy", "99", "approved");
        listing(user, "Wrong bhk", "rent", "98", "approved");

        Property elsewhere = listing(user, "Wrong locality", "rent", "99", "approved");
        seedLocality("d227-somewhere-else", "D227 Somewhere Else");
        elsewhere.setLocalitySlug("d227-somewhere-else");
        elsewhere.setLocality("Somewhere Else");
        properties.saveAndFlush(elsewhere);
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("a multi-valued facet is an OR, which is why the browser could not ask /properties")
    void multipleLocalitiesAndBhksAreUnioned() {
        User user = owner("9820600004");
        seedLocality();
        seedLocality("d227-second", "D227 Second");
        alert(user, "{\"deal\":\"rent\",\"localities\":[\"" + SLUG
                + "\",\"d227-second\"],\"bhk\":[98,99]}");

        listing(user, "Here 99", "rent", "99", "approved");
        listing(user, "Here 98", "rent", "98", "approved");
        Property second = listing(user, "There 99", "rent", "99", "approved");
        second.setLocalitySlug("d227-second");
        second.setLocality("D227 Second");
        properties.saveAndFlush(second);
        listing(user, "Here 97", "rent", "97", "approved");
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isEqualTo(3);
    }

    @Test
    @DisplayName("an empty facet is no constraint, not an impossible one")
    void omittedFacetsDoNotNarrow() {
        User user = owner("9820600005");
        seedLocality();

        alert(user, "{\"deal\":\"rent\",\"localities\":[\"" + SLUG + "\"]}");

        listing(user, "99 here", "rent", "99", "approved");
        listing(user, "98 here", "rent", "98", "approved");
        listing(user, "99 to buy", "buy", "99", "approved");
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isEqualTo(2);
    }

    private record Home(String deal, String type, long price, String bhk, String furnishing) {
        Home(String deal, String bhk) {
            this(deal, "apartment", 31000L, bhk, null);
        }
    }

    static Stream<Arguments> narrowingFacets() {
        String in = "{\"deal\":\"%s\",\"localities\":[\"" + SLUG + "\"],%s}";
        return Stream.of(
                Arguments.of("budget range excludes out-of-range homes",
                        in.formatted("rent", "\"rent\":[0,30000]"),
                        List.of(new Home("rent", "apartment", 31000L, "99", null)), 0),
                Arguments.of("an in-range budget still counts matching homes",
                        in.formatted("rent", "\"rent\":[30000,32000]"),
                        List.of(new Home("rent", "apartment", 31000L, "99", null)), 1),
                Arguments.of("the UI's open-ended budget top is treated as unbounded",
                        in.formatted("buy", "\"budget\":[0,50000000]"),
                        List.of(new Home("buy", "apartment", 60000000L, "4", null)), 1),
                Arguments.of("open-ended BHK chips match larger homes without widening to every BHK",
                        in.formatted("buy", "\"bhk\":[\"3plus\"]"),
                        List.of(new Home("buy", "apartment", 9000000L, "4", null),
                                new Home("buy", "apartment", 9000000L, "2", null)), 1),
                Arguments.of("garbage BHK tokens are ignored without aborting the read",
                        in.formatted("rent", "\"bhk\":[\"1e999999\"]"),
                        List.of(new Home("rent", "1"), new Home("rent", "2")), 2),
                Arguments.of("property type narrows the count",
                        in.formatted("buy", "\"types\":[\"villa\"]"),
                        List.of(new Home("buy", "villa", 9000000L, "4", null),
                                new Home("buy", "apartment", 9000000L, "4", null)), 1),
                Arguments.of("furnishing narrows rent alerts",
                        in.formatted("rent", "\"furnishing\":[\"furnished\"]"),
                        List.of(new Home("rent", "apartment", 31000L, "2", "furnished"),
                                new Home("rent", "apartment", 31000L, "2", "unfurnished")), 1),
                Arguments.of("legacy postedBy saved-search criteria is ignored",
                        in.formatted("rent", "\"postedBy\":\"agent\""),
                        List.of(new Home("rent", "2")), 1));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("narrowingFacets")
    @DisplayName("saved facets narrow the live-match count")
    void facetNarrowsMatches(String label, String filters, List<Home> homes, int expected) {
        User user = owner("9820600012");
        seedLocality();
        alert(user, filters);

        for (Home home : homes) {
            Property p = listing(user, "Home", home.deal(), home.type(), home.price(), home.bhk(),
                    "approved");
            if (home.furnishing() != null) {
                p.setFurnishing(home.furnishing());
                properties.saveAndFlush(p);
            }
        }
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isEqualTo(expected);
    }

    @Test
    @DisplayName("facing, bathrooms and food saved facets match the public search semantics")
    void residentialFacetsMatchSearchSemantics() {
        User user = owner("9820600021");
        seedLocality();
        alert(user, "{\"deal\":\"rent\",\"localities\":[\"" + SLUG
                + "\"],\"facing\":\"east\",\"minBaths\":2,\"food\":\"nonveg\"}");

        Property match = listing(user, "East two bath", "rent", "2", "approved");
        match.setFacing("East");
        match.setBathrooms(2);
        match.setFormDetails(Map.of("food", "any"));
        properties.saveAndFlush(match);
        Property unstatedBath = listing(user, "East bath unstated", "rent", "2", "approved");
        unstatedBath.setFacing("east");
        unstatedBath.setFormDetails(Map.of("foodPref", "nonveg"));
        properties.saveAndFlush(unstatedBath);
        Property veg = listing(user, "Veg only", "rent", "2", "approved");
        veg.setFacing("east");
        veg.setBathrooms(2);
        veg.setFormDetails(Map.of("foodPref", "veg"));
        properties.saveAndFlush(veg);
        Property wrongFacing = listing(user, "West", "rent", "2", "approved");
        wrongFacing.setFacing("west");
        wrongFacing.setBathrooms(2);
        wrongFacing.setFormDetails(Map.of("food", "any"));
        properties.saveAndFlush(wrongFacing);
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("a saved Jain-only food facet counts only listings whose owner stated Jain")
    void jainFoodFacetMatchesStatedRuleOnly() {
        User user = owner("9820600029");
        seedLocality();
        alert(user, "{\"deal\":\"rent\",\"localities\":[\"" + SLUG + "\"],\"food\":\"jain\"}");

        Property jain = listing(user, "Jain only", "rent", "2", "approved");
        jain.setFormDetails(Map.of("foodPref", "jain"));
        properties.saveAndFlush(jain);
        Property veg = listing(user, "Veg only", "rent", "2", "approved");
        veg.setFormDetails(Map.of("foodPref", "veg"));
        properties.saveAndFlush(veg);
        properties.saveAndFlush(listing(user, "Food unstated", "rent", "2", "approved"));
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("commercial shell and pre-leased saved facets read JSONB")
    void commercialJsonFacetsNarrowMatches() {
        User user = owner("9820600022");
        seedLocality();
        alert(user, "{\"deal\":\"buy\",\"localities\":[\"" + SLUG
                + "\"],\"shell\":\"bareShell\",\"preLeased\":true}");

        Property leasedBare = listing(user, "Leased bare", "buy", "commercial", 9000000L, "0", "approved");
        leasedBare.setFormDetails(Map.of("shellType", "bareShell", "tenancyStatus", "leased"));
        properties.saveAndFlush(leasedBare);
        Property vacantBare = listing(user, "Vacant bare", "buy", "commercial", 9000000L, "0", "approved");
        vacantBare.setFormDetails(Map.of("shellType", "bareShell", "tenancyStatus", "vacant"));
        properties.saveAndFlush(vacantBare);
        Property leasedWarm = listing(user, "Leased warm", "buy", "commercial", 9000000L, "0", "approved");
        leasedWarm.setFormDetails(Map.of("shellType", "warmShell", "tenancyStatus", "leased"));
        properties.saveAndFlush(leasedWarm);
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("NA and area saved facets compare against area converted to square feet")
    void landAreaFacetsNormalizeUnits() {
        User user = owner("9820600023");
        seedLocality();
        alert(user, "{\"deal\":\"buy\",\"localities\":[\"" + SLUG
                + "\"],\"na\":\"sanctioned\",\"minArea\":43000,\"maxArea\":44000}");

        Property acre = listing(user, "One acre", "buy", "farmland", 9000000L, "0", "approved");
        acre.setArea(new BigDecimal("1"));
        acre.setAreaUnit("acre");
        acre.setFormDetails(Map.of("naStatus", "sanctioned"));
        properties.saveAndFlush(acre);
        Property sqft = listing(user, "Small plot", "buy", "plot", 9000000L, "0", "approved");
        sqft.setArea(new BigDecimal("1000"));
        sqft.setAreaUnit("sqft");
        sqft.setFormDetails(Map.of("naStatus", "sanctioned"));
        properties.saveAndFlush(sqft);
        Property deemed = listing(user, "Deemed acre", "buy", "farmland", 9000000L, "0", "approved");
        deemed.setArea(new BigDecimal("1"));
        deemed.setAreaUnit("acre");
        deemed.setFormDetails(Map.of("naStatus", "deemed"));
        properties.saveAndFlush(deemed);
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("a search with no deal counts nothing rather than counting the whole catalogue")
    void noDealCountsNothing() {
        User user = owner("9820600006");
        seedLocality();
        alert(user, "{\"localities\":[\"" + SLUG + "\"],\"bhk\":[99]}");

        listing(user, "99BHK", "rent", "99", "approved");
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isZero();
    }

    @Test
    @DisplayName("a malformed filters blob answers zero, not a 500 on the user's own alert list")
    void unreadableFiltersCountZero() {
        User user = owner("9820600007");
        seedLocality();
        SavedSearch search = alert(user, "{\"deal\":\"rent\"}");

        jdbc.update("update saved_searches set filters = '[]'::jsonb where id = ?", search.getId());
        listing(user, "99BHK", "rent", "99", "approved");
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isZero();
    }

    @Test
    @DisplayName("a flatmates alert counts the flatmate board using its own facets")
    void flatmatesAlertsAreCounted() {
        User user = owner("9820600008");
        seedLocality();
        jdbc.update("""
                insert into flatmate_seeker_posts
                    (user_id, name, gender, budget, localities, tags, mod_status)
                values (?, 'D227 Seeker', 'female', 18000, '[\"D227 Flatmate Town\"]'::jsonb,
                    '[\"Vegetarian\"]'::jsonb, 'approved')
                """, user.getId());
        em.flush();
        em.clear();

        SavedSearchResponse created = savedSearches.create(user.getId(),
                new SavedSearchCreateRequest("Flatmate in " + NAME, "flatmates", null,
                        Map.of("deal", "rent", "localities", List.of(SLUG), "bhk", List.of(99)),
                        Map.of("tab", "team-up", "locality", "D227 Flatmate Town",
                                "budgetMin", 15000, "budget", 20000,
                                "gender", "female", "habits", List.of("Vegetarian")),
                        null, null));

        assertThat(created.matchCount()).isEqualTo(1);
        assertThat(only(user).matchCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("the count is the caller's own — another user's identical alert is counted for them")
    void countIsPerCallerButNotPerOwner() {
        User poster = owner("9820600009");
        User searcher = owner("9820600010");
        seedLocality();
        alert(searcher, "{\"deal\":\"rent\",\"localities\":[\"" + SLUG + "\"],\"bhk\":[99]}");

        // The catalogue is public: a searcher's count is over every live listing, not only their own.
        // That is the opposite of the own-listing duplicate check and deliberately so.
        listing(poster, "Somebody else's 99BHK", "rent", "99", "approved");
        em.flush();
        em.clear();

        assertThat(only(searcher).matchCount()).isEqualTo(1);
        assertThat(savedSearches.list(poster.getId())).isEmpty();
    }

    @Test
    @DisplayName("the created row already carries its count, so the card never renders a stale zero")
    void createReturnsTheCount() {
        User user = owner("9820600011");
        seedLocality();
        listing(user, "99BHK", "rent", "99", "approved");
        em.flush();
        em.clear();

        SavedSearchResponse created = savedSearches.create(user.getId(),
                new SavedSearchCreateRequest("D227 alert", "listings", "rent " + SLUG,
                        Map.of("deal", "rent", "localities", List.of(SLUG), "bhk", List.of(99)),
                        null, null, null));

        // The alert card renders the count the moment it is saved. Serving 0 here and the real
        // number on the next list read would look like the alert found nothing.
        assertThat(created.matchCount()).isEqualTo(1);
        assertThat(created.newCount()).isZero();
    }

    @Test
    @DisplayName("creating identical criteria returns the existing saved search")
    void duplicateCriteriaReturnsExistingSearch() {
        User user = owner("9820600020");
        seedLocality();
        Map<String, Object> filters = Map.of("deal", "rent", "localities", List.of(SLUG),
                "bhk", List.of(98, 99));
        Map<String, Object> sameFilters = Map.of("bhk", List.of(99, 98),
                "localities", List.of(SLUG), "deal", "rent");

        SavedSearchResponse first = savedSearches.create(user.getId(),
                new SavedSearchCreateRequest("First", "listings", "rent " + SLUG,
                        filters, null, null, null));
        SavedSearchResponse second = savedSearches.create(user.getId(),
                new SavedSearchCreateRequest("Second", "listings", "rent " + SLUG,
                        sameFilters, null, null, null));

        assertThat(second.id()).isEqualTo(first.id());
        assertThat(savedSearches.list(user.getId())).hasSize(1);
    }
}
