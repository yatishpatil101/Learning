package com.punenest.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.engagement.search.SavedSearch;
import com.punenest.api.engagement.search.SavedSearchCreateRequest;
import com.punenest.api.engagement.search.SavedSearchRepository;
import com.punenest.api.engagement.search.SavedSearchResponse;
import com.punenest.api.engagement.search.SavedSearchService;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * D227 — a saved search reports how many listings match it, counted by the server.
 *
 * <p>The defect this closes was in the browser: the notifications screen and the dashboard
 * retention strip both fetched one page of the catalogue ({@code size=100}) and counted the matches
 * themselves. That is correct exactly while the catalogue fits on one page and silently wrong
 * afterwards, with nothing failing — the number simply stops growing, and it stops growing for the
 * users with the broadest searches, who are the ones the strip exists to bring back.
 *
 * <p>These tests seed a locality and a deliberately absurd BHK so the assertions are exact numbers
 * rather than "greater than the fixtures". The seeded demo catalogue has no 99-BHK homes.
 */
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
        Property p = new Property(owner, title, deal, "apartment", 31000L, NAME, "Pune");
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
        SavedSearch search = alert(user,
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
        assertThat(search.getNewCount()).isZero();
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
        // No bhk at all: every rented home in the locality matches, whatever its size.
        alert(user, "{\"deal\":\"rent\",\"localities\":[\"" + SLUG + "\"]}");

        listing(user, "99 here", "rent", "99", "approved");
        listing(user, "98 here", "rent", "98", "approved");
        listing(user, "99 to buy", "buy", "99", "approved");
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isEqualTo(2);
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

        // A saved search with no deal is not "match everything" — it is a row whose facets were
        // never filled in, and telling its owner the size of the catalogue would be a fabrication.
        assertThat(only(user).matchCount()).isZero();
    }

    @Test
    @DisplayName("a malformed filters blob answers zero, not a 500 on the user's own alert list")
    void unreadableFiltersCountZero() {
        User user = owner("9820600007");
        seedLocality();
        SavedSearch search = alert(user, "{\"deal\":\"rent\"}");
        // jsonb rejects a non-JSON string, so the reachable bad shape is valid JSON that is not an
        // object — which is what a client sending an array of facets would produce.
        jdbc.update("update saved_searches set filters = '[]'::jsonb where id = ?", search.getId());
        listing(user, "99BHK", "rent", "99", "approved");
        em.flush();
        em.clear();

        assertThat(only(user).matchCount()).isZero();
    }

    @Test
    @DisplayName("a flatmates alert counts zero — this number is about the listings catalogue")
    void flatmatesAlertsAreNotCounted() {
        User user = owner("9820600008");
        seedLocality();
        listing(user, "99BHK", "rent", "99", "approved");
        em.flush();
        em.clear();

        SavedSearchResponse created = savedSearches.create(user.getId(),
                new SavedSearchCreateRequest("Flatmate in " + NAME, "flatmates", null,
                        Map.of("deal", "rent", "localities", List.of(SLUG), "bhk", List.of(99)),
                        Map.of("locality", SLUG), null, null));

        // The filters blob would match if it were read, and it deliberately is not: a flatmates
        // alert watches a different catalogue, and reporting listings matches against it would be
        // a number about the wrong thing.
        assertThat(created.matchCount()).isZero();
        assertThat(only(user).matchCount()).isZero();
    }

    @Test
    @DisplayName("the count is the caller's own — another user's identical alert is counted for them")
    void countIsPerCallerButNotPerOwner() {
        User poster = owner("9820600009");
        User searcher = owner("9820600010");
        seedLocality();
        alert(searcher, "{\"deal\":\"rent\",\"localities\":[\"" + SLUG + "\"],\"bhk\":[99]}");

        // The catalogue is public: a searcher's count is over every live listing, not only their
        // own. That is the opposite of the own-listing duplicate check (D226) and deliberately so.
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
}
