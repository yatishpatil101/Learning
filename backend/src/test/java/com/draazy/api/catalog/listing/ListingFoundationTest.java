package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyController;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * The foundation-field rule, tied to the search facets it protects: a facet outside the rule is a bait-and-switch
 * hole. Facets are reflected off {@link PropertyController#search} so a third hand-kept list cannot drift.
 */
@DisplayName("Listings — every search facet costs a re-review, at one of two prices")
class ListingFoundationTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    /**
     * Foundation fields whose edit takes the listing <strong>off search</strong>: they change what it is, so a
     * stale index entry is a wrong answer. This test's half of the contract; the other is ListingEditRules.apply.
     */
    private static final Set<String> OFF_SEARCH =
            Set.of("bhk", "propertyType", "locality", "deal");

    /**
     * Re-checked but still live, the listing being the same property. {@code address} is here because it derives
     * the duplicate key; {@code images}/{@code description}/{@code amenities} are the evidence approval rested on.
     */
    private static final Set<String> STAYS_LIVE =
            Set.of("price", "furnishing", "possession", "address", "images", "description", "amenities");

    /**
     * Facets with no listing attribute behind them: price bounds, free text over editable marketing copy, the
     * moderation state, the owner id (untransferable by PATCH) and the result ordering.
     */
    private static final Set<String> NOT_LISTING_ATTRIBUTES =
            Set.of("minPrice", "maxPrice", "q", "status", "owner", "rank");

    /** {@code type} is the wire spelling of the entity's {@code propertyType}. */
    private static String toFieldName(String facet) {
        return "type".equals(facet) ? "propertyType" : facet;
    }

    private static List<String> searchFacets() {
        Method search = Arrays.stream(PropertyController.class.getDeclaredMethods())
                .filter(m -> "search".equals(m.getName()))
                .findFirst()
                .orElseThrow(() -> new AssertionError(
                        "PropertyController.search is gone — this test measures the wrong thing"));
        return Arrays.stream(search.getParameters())
                .filter(p -> p.isAnnotationPresent(RequestParam.class))
                .map(java.lang.reflect.Parameter::getName)
                .toList();
    }

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Foundation Owner");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property approvedListing(User owner) {
        return approvedListing(owner, "Bright 2BHK");
    }

    private Property approvedListing(User owner, String title) {
        Property p = new Property(owner, title, "rent", "apartment",
                25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setStatus(PropertyStatus.APPROVED);
        p.setFurnishing("unfurnished");
        p.setPossession("under-construction");
        // Filed, because saving through the repository skips LocalityResolver and re-approval refuses an
        // unfiled listing — an approved listing with a null slug is not a state the platform produces.
        p.setLocalitySlug("kothrud");
        return properties.saveAndFlush(p);
    }

    /**
     * The guard against a facet being added and left unprotected. Not a behaviour check — only that somebody
     * decided which side a facet is on, and that it is exactly one of the two sets.
     */
    @Test
    @DisplayName("every search facet is either a foundation field or a recorded exemption")
    void everySearchFacetIsClassified() {
        assertThat(OFF_SEARCH)
                .as("a field cannot both leave search and stay in it — one of the two sets is wrong")
                .doesNotContainAnyElementsOf(STAYS_LIVE);

        Set<String> foundationCases = new TreeSet<>(OFF_SEARCH);
        foundationCases.addAll(STAYS_LIVE);

        List<String> facets = searchFacets();
        assertThat(facets)
                .as("reflection returned no parameter names — the build must keep -parameters on, "
                        + "or this test passes by comparing nothing")
                .isNotEmpty();

        Set<String> unclassified = new TreeSet<>();
        for (String facet : facets) {
            if (!NOT_LISTING_ATTRIBUTES.contains(facet)
                    && !foundationCases.contains(toFieldName(facet))) {
                unclassified.add(facet);
            }
        }

        assertThat(unclassified)
                .as("a buyer can filter on these but an owner can change them on an approved "
                        + "listing with no re-review at all. Add the field to one of the two "
                        + "foundation blocks in ListingEditRules.apply, to the matching set here, "
                        + "and give it a case below — or record why it is exempt in "
                        + "NOT_LISTING_ATTRIBUTES")
                .isEmpty();
    }

    private void assertRevertsToPending(String jsonPatch) throws Exception {
        User o = owner("98765" + String.format("%05d", Math.abs(jsonPatch.hashCode()) % 100000));
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(jsonPatch))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.recheckPending").value(false));
    }

    /**
     * The stays-live half: still approved, and a re-check naming the field. Searchability is proven separately
     * in {@link #aPriceEditKeepsTheListingInSearch} — status is the mechanism, being findable is the promise.
     */
    private void assertStaysLiveAndQueuesRecheck(String jsonPatch, String field) throws Exception {
        User o = owner("98764" + String.format("%05d", Math.abs(jsonPatch.hashCode()) % 100000));
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(jsonPatch))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(true))
                .andExpect(jsonPath("$.recheckReason").value(field));
    }

    @Test
    @DisplayName("bhk, type, locality and deal take the listing off search — they change what it is")
    void identityEditsRevert() throws Exception {
        assertRevertsToPending("{\"bhk\":3}");
        assertRevertsToPending("{\"propertyType\":\"villa\"}");
        assertRevertsToPending("{\"locality\":\"Baner\"}");
        assertRevertsToPending("{\"deal\":\"buy\"}");
    }

    /**
     * Each is a filter a buyer trusts, so each is re-checked — but the listing is still that flat, so the
     * re-check happens with it in search rather than out of it.
     */
    @Test
    @DisplayName("price, furnishing and possession stay live and queue a re-check instead")
    void attributeEditsStayLive() throws Exception {
        assertStaysLiveAndQueuesRecheck("{\"price\":31000}", "price");
        assertStaysLiveAndQueuesRecheck("{\"furnishing\":\"furnished\"}", "furnishing");
        assertStaysLiveAndQueuesRecheck("{\"possession\":\"ready-to-move\"}", "possession");
    }

    /**
     * No buyer filters on the address, but editing it is how a listing moves onto a flat somebody else is
     * selling — indistinguishable from a typo fix, so the re-check is raised either way.
     */
    @Test
    @DisplayName("an address edit stays live and queues a re-check, naming the field")
    void anAddressEditStaysLiveAndQueuesARecheck() throws Exception {
        assertStaysLiveAndQueuesRecheck("{\"address\":\"Flat 902, C Wing, Rohan Nilay\"}", "address");
    }

    /**
     * The evidence half: replacing the photographs, prose and amenities sells a verdict never given about what
     * is now on the page. No buyer filters on these, so the listing stays findable while the desk looks again.
     */
    @Test
    @DisplayName("photos, description and amenities stay live and queue a re-check")
    void evidenceEditsStayLiveAndQueueARecheck() throws Exception {
        assertStaysLiveAndQueuesRecheck("{\"images\":[\"https://cdn.example/new.jpg\"]}", "images");
        assertStaysLiveAndQueuesRecheck("{\"description\":\"Newly renovated, south facing.\"}", "description");
        assertStaysLiveAndQueuesRecheck("{\"amenities\":[\"Gym\",\"Lift\"]}", "amenities");
    }

    /**
     * Asserted against the thing that actually pays the owner. {@code status} staying approved is the mechanism;
     * {@code GET /properties} hard-floors to approved and un-archived, so this is the promise.
     */
    @Test
    @DisplayName("a price edit leaves the listing findable in public search, re-check and all")
    void aPriceEditKeepsTheListingInSearch() throws Exception {
        User o = owner("9876533333");
        Property p = approvedListing(o, "Zephyrine Riverside Loft");

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":31000}"))
                .andExpect(status().isOk());

        mvc.perform(get("/properties").param("q", "Zephyrine Riverside Loft"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id=='" + p.getId() + "')]").exists())
                .andExpect(jsonPath("$.content[?(@.id=='" + p.getId() + "')].price")
                        .value(org.hamcrest.Matchers.contains(31000)));

        assertThat(properties.findById(p.getId()).orElseThrow().isRecheckPending())
                .as("the edit must still be queued for a moderator — staying live is not the same "
                        + "as going unreviewed")
                .isTrue();
    }

    /**
     * When one PATCH trips both halves the revert wins and no re-check is left behind: a full re-moderation
     * already looks at the whole listing, so queueing the price change too shows the same edit twice.
     */
    @Test
    @DisplayName("an edit that trips both halves reverts, and does not also queue a re-check")
    void remoderationSupersedesRecheck() throws Exception {
        User o = owner("9876544444");
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":31000,\"bhk\":3}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.recheckPending").value(false));
    }

    /**
     * A stays-live re-check is a request for a decision, and this is where decisions are made, so acting on the
     * listing clears it. Otherwise the queue only grows and "live but flagged" becomes a flag nobody reads.
     */
    @Test
    @DisplayName("a moderator setting a status clears the pending re-check")
    void moderatorActionClearsTheRecheck() throws Exception {
        User o = owner("9876555555");
        User staff = new User("9000000001", "staff");
        staff.setName("Ops");
        staff.setMobileVerified(true);
        users.saveAndFlush(staff);
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":31000}"))
                .andExpect(jsonPath("$.recheckPending").value(true));

        mvc.perform(patch("/properties/" + p.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\",\"reason\":\"price checked\"}"))
                .andExpect(status().isOk());

        assertThat(properties.findById(p.getId()).orElseThrow().isRecheckPending())
                .as("the moderator has looked; the work item is done")
                .isFalse();
    }

    /**
     * The other half of the rule: without it, "re-review everything" passes every case above while making a
     * deposit correction cost a moderator's time. These fields are ones no reviewer looked at to approve.
     */
    @Test
    @DisplayName("a non-searchable edit still leaves an approved listing approved and unqueued")
    void nonFoundationEditsDoNotRevert() throws Exception {
        User o = owner("9876511111");
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deposit\":50000,\"negotiable\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(false));
    }

    /**
     * PATCH semantics: re-sending a field's current value is not an edit. The natural "the field was present, so
     * re-review" passes every case above while making an owner who saves a form twice wait on a moderator.
     */
    @Test
    @DisplayName("re-sending an unchanged foundation value is not an edit, on either side")
    void unchangedValuesAreNotEdits() throws Exception {
        User o = owner("9876522222");
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bhk\":2,\"furnishing\":\"unfurnished\","
                                + "\"possession\":\"under-construction\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(false));
    }
}
