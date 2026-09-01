package com.punenest.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyController;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
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
 * The foundation-field rule, tied to the search facets it exists to protect.
 *
 * <p><strong>What the rule is for.</strong> Editing a foundation field on an approved listing costs
 * the owner a re-review. That exists to stop bait-and-switch, and bait-and-switch has a precise
 * shape: get approved into one set of search results, then edit your way into a different, more
 * valuable one. So the fields that must trigger a re-review are exactly the fields a buyer can
 * filter on. A facet outside the rule is a hole of exactly that shape.
 *
 * <p><strong>Two prices, not one (Q14).</strong> Every foundation edit is re-checked; they differ
 * only in whether the listing keeps earning while it waits. {@code locality}, {@code propertyType},
 * {@code bhk} and {@code deal} change what the listing fundamentally <em>is</em>, so leaving it in
 * the index returns a wrong answer — a 2BHK under 3BHK, a rental under sale — and it goes back to
 * {@code pending}. {@code price}, {@code furnishing} and {@code possession} change an attribute of
 * a listing that is still the same property, so the worst case is a briefly stale value on a
 * listing that is genuinely what it claims to be; those stay {@code approved}, stay in search, and
 * raise {@code recheckPending} instead.
 *
 * <p><strong>Why the facets are read by reflection.</strong> The rule was five fields — price, bhk,
 * type, locality, deal — while {@code GET /properties} accepted seven facets. The two extra,
 * {@code furnishing} and {@code possession}, were applied as ordinary edits, so an approved
 * unfurnished flat could be relabelled "furnished" and an under-construction one "ready to move"
 * with no moderator involved. Nothing failed, because nothing connected the two lists: they lived in
 * different packages and agreed only by someone remembering. Writing the facet list out by hand here
 * would reproduce that failure — a third hand-maintained list drifting on the same schedule as the
 * first two — so it is read off {@link PropertyController#search} itself.
 *
 * <p><strong>And why the rule is asserted behaviourally.</strong> Reflection can see the facets but
 * not what {@code ListingEditRules.apply} does with them; a constant listing the foundation fields
 * would be a claim about the implementation rather than a measurement of it. So each field is
 * actually PATCHed onto an approved listing through the real endpoint, and the resulting status —
 * and, for the stays-live half, an actual {@code GET /properties} hit — is the assertion. The two
 * halves together are what make this self-maintaining: a new facet fails
 * {@link #everySearchFacetIsClassified} until it is classified, and a field that changes sides
 * fails its own case here.
 */
@DisplayName("Listings — every search facet costs a re-review, at one of two prices")
class ListingFoundationTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    /**
     * Foundation fields whose edit takes the listing <strong>off search</strong>: they change what
     * the listing is, so a stale index entry is a wrong answer rather than a late one (Q14).
     *
     * <p>Kept here, and only here, as this test's half of the contract — the other half is the
     * blocks in {@code ListingEditRules.apply}, which is what the cases below actually measure.
     */
    private static final Set<String> OFF_SEARCH =
            Set.of("bhk", "propertyType", "locality", "deal");

    /**
     * Foundation fields whose edit <strong>stays live</strong>: re-checked, but still approved and
     * still in search, because the listing is still the same property (Q14).
     *
     * <p>{@code address} is here for a different reason from the other three and is deliberately not
     * a search facet: it is what the duplicate key is derived from, so editing it is how a listing
     * moves onto an address another owner already holds (D219). Being in this set rather than the
     * one above is the whole of the decision — an address correction is overwhelmingly a typo fix,
     * and taking the listing dark for one would price honesty at a day offline.
     */
    private static final Set<String> STAYS_LIVE =
            Set.of("price", "furnishing", "possession", "address");

    /**
     * Facets that legitimately do not cost a re-review, each for a reason about the facet rather
     * than about convenience.
     *
     * <ul>
     *   <li>{@code minPrice} / {@code maxPrice} — bounds on {@code price}, which <em>is</em> a
     *       foundation field. They are not listing attributes; there is nothing on the entity for
     *       them to change.</li>
     *   <li>{@code q} — free-text over title and description. Title is deliberately editable without
     *       review: it is marketing copy, it is the field owners most often fix typos in, and
     *       reverting on it would make correcting "2BKH" cost a day offline.</li>
     *   <li>{@code status} — the moderation state itself, owned by moderation rather than by the
     *       owner. Reverting on it would mean approving a listing sends it back to pending.</li>
     *   <li>{@code owner} — the owner's id, matched with {@code cb.equal(root.get("owner").get("id"),
     *       UUID.fromString(...))} in {@code PropertySpecs}. It is not a listing attribute at all:
     *       there is no edit that changes it, because a listing cannot be transferred through
     *       {@code PATCH /me/listings/{id}}. Ownership moves, when it moves, through a path that
     *       re-reviews the listing for its own reasons.</li>
     * </ul>
     */
    private static final Set<String> NOT_LISTING_ATTRIBUTES =
            Set.of("minPrice", "maxPrice", "q", "status", "owner");

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
        return properties.saveAndFlush(p);
    }

    /**
     * The guard against a facet being added and quietly left unprotected. It does not check the
     * behaviour — the cases below do that — only that somebody has decided which side a facet is on,
     * and that "which side" is a real answer: exactly one of the two sets, never both and never
     * neither.
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
     * The stays-live half: still approved, and a re-check work item naming the field that earned it.
     * Searchability itself is proven separately in {@link #aPriceEditKeepsTheListingInSearch} —
     * status is the mechanism, but being findable is the promise.
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
     * The other three foundation fields (Q14). Each is still a filter a buyer trusts, so each is
     * still re-checked — relabelling an unfurnished flat as furnished, or an under-construction one
     * as ready to move, moves it into a filter it has not earned. But the listing is still that
     * flat, so the re-check happens with it in search rather than out of it.
     */
    @Test
    @DisplayName("price, furnishing and possession stay live and queue a re-check instead")
    void attributeEditsStayLive() throws Exception {
        assertStaysLiveAndQueuesRecheck("{\"price\":31000}", "price");
        assertStaysLiveAndQueuesRecheck("{\"furnishing\":\"furnished\"}", "furnishing");
        assertStaysLiveAndQueuesRecheck("{\"possession\":\"ready-to-move\"}", "possession");
    }

    /**
     * The fourth stays-live field, which no buyer filters on (D219). An owner who edits the address
     * has either corrected a typo or moved the listing onto a flat somebody else is already selling,
     * and the two are indistinguishable from the text. The duplicate probe only speaks when the
     * second case actually collides with a live listing; this re-check is raised either way, so the
     * desk sees the edit rather than only its consequences.
     */
    @Test
    @DisplayName("an address edit stays live and queues a re-check, naming the field")
    void anAddressEditStaysLiveAndQueuesARecheck() throws Exception {
        assertStaysLiveAndQueuesRecheck("{\"address\":\"Flat 902, C Wing, Rohan Nilay\"}", "address");
    }

    /**
     * The point of the whole split, asserted against the thing that actually pays the owner: the
     * public search. {@code status} staying {@code approved} is only the mechanism —
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
     * When one PATCH trips both halves, the revert wins and no separate re-check is left behind: a
     * full re-moderation already looks at the whole listing, so queueing the price change as well
     * would put the same edit in front of a moderator twice.
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
     * A stays-live re-check is a request for a moderator's decision, and this is where decisions are
     * made — so acting on the listing at all clears it. Without this the queue only ever grows, and
     * "live but flagged" becomes a flag nobody reads, which is the failure mode Q14 named.
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
     * The other half of the rule. Without this, "re-review everything" would pass every case above
     * and make editing a photo caption cost a moderator's time.
     */
    @Test
    @DisplayName("a non-searchable edit still leaves an approved listing approved and unqueued")
    void nonFoundationEditsDoNotRevert() throws Exception {
        User o = owner("9876511111");
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"description\":\"Newly painted, great light\",\"deposit\":50000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(false));
    }

    /**
     * PATCH semantics: re-sending a field's current value is not an edit. Worth pinning separately
     * because the natural implementation — "the field was present, so re-review" — passes every test
     * above while sending listings to a moderator for changing nothing, which is how an owner saving
     * a form twice loses a day (or, now, wastes a moderator's).
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
