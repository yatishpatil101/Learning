package com.punenest.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
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
 * <p><strong>What the rule is for.</strong> Editing a foundation field on an approved listing sends
 * it back to {@code pending}. That exists to stop bait-and-switch, and bait-and-switch has a precise
 * shape: get approved into one set of search results, then edit your way into a different, more
 * valuable one. So the fields that must trigger re-moderation are exactly the fields a buyer can
 * filter on. A facet outside the rule is a hole of exactly that shape.
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
 * not what {@code ListingService.apply} does with them; a constant listing the foundation fields
 * would be a claim about the implementation rather than a measurement of it. So each field is
 * actually PATCHed onto an approved listing through the real endpoint, and the resulting status is
 * the assertion. The two halves together are what make this self-maintaining: a new facet fails
 * {@link #everySearchFacetIsClassified} until it is classified, and a field that stops reverting
 * fails its own case here.
 */
@DisplayName("Listings — every search facet costs re-moderation")
class ListingFoundationTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    /**
     * Facets that legitimately do not revert a listing, each for a reason about the facet rather
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
     * </ul>
     */
    private static final Set<String> NOT_LISTING_ATTRIBUTES =
            Set.of("minPrice", "maxPrice", "q", "status");

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
        Property p = new Property(owner, "Bright 2BHK", "rent", "apartment",
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
     * behaviour — the cases below do that — only that somebody has decided which side a facet is on.
     */
    @Test
    @DisplayName("every search facet is either a foundation field or a recorded exemption")
    void everySearchFacetIsClassified() {
        Set<String> foundationCases = Set.of(
                "price", "bhk", "propertyType", "locality", "deal", "furnishing", "possession");

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
                        + "listing without re-moderation. Add the field to the foundation block in "
                        + "ListingService.apply and give it a case below, or record why it is "
                        + "exempt in NOT_LISTING_ATTRIBUTES")
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
                .andExpect(jsonPath("$.status").value("pending"));
    }

    @Test
    @DisplayName("price, bhk, type, locality and deal revert an approved listing")
    void theOriginalFiveRevert() throws Exception {
        assertRevertsToPending("{\"price\":31000}");
        assertRevertsToPending("{\"bhk\":3}");
        assertRevertsToPending("{\"propertyType\":\"villa\"}");
        assertRevertsToPending("{\"locality\":\"Baner\"}");
        assertRevertsToPending("{\"deal\":\"buy\"}");
    }

    /**
     * The two this pass added, and the reason the whole test exists. Relabelling an unfurnished flat
     * as furnished, or an under-construction one as ready to move, moves it into a filter a buyer
     * trusts — which is the definition of the thing re-moderation is for.
     */
    @Test
    @DisplayName("furnishing and possession revert too — they are filters a buyer trusts")
    void theTwoThatUsedToSlipThrough() throws Exception {
        assertRevertsToPending("{\"furnishing\":\"furnished\"}");
        assertRevertsToPending("{\"possession\":\"ready-to-move\"}");
    }

    /**
     * The other half of the rule. Without this, "revert on everything" would pass every case above
     * and make editing a photo caption cost a day offline.
     */
    @Test
    @DisplayName("a non-searchable edit still leaves an approved listing approved")
    void nonFoundationEditsDoNotRevert() throws Exception {
        User o = owner("9876511111");
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"description\":\"Newly painted, great light\",\"deposit\":50000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"));
    }

    /**
     * PATCH semantics: re-sending a field's current value is not an edit. Worth pinning separately
     * because the natural implementation — "the field was present, so revert" — passes every test
     * above while sending listings back to moderation for changing nothing, which is how an owner
     * saving a form twice loses a day.
     */
    @Test
    @DisplayName("re-sending an unchanged foundation value does not revert")
    void unchangedValuesAreNotEdits() throws Exception {
        User o = owner("9876522222");
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"furnishing\":\"unfurnished\",\"possession\":\"under-construction\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"));
    }
}
