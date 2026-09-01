package com.draazy.api.catalog.listing;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * {@code POST /me/listings/duplicate-check} — "have I already listed this?" (D226).
 *
 * <p><strong>The defect this closes.</strong> The wizard used to answer this question in the
 * browser, against the listings its local store happened to hold. Against a live API that store is
 * the seeded demo catalogue, so the check could stop a real owner over a fixture and then offer to
 * "edit the one you already have" — a link to an id the server had never issued. Two things had to
 * become true: the comparison has to run over the caller's real listings, and the id it hands back
 * has to be one the server will resolve. Both are asserted below.
 *
 * <p><strong>What the cases are really about.</strong> Only two of them are about finding a
 * duplicate. The rest pin the boundaries, and each boundary is a way this endpoint could turn into
 * something it must not be:
 *
 * <ul>
 *   <li>A stranger's identical listing must be invisible here, or an owner-facing convenience
 *       becomes a lookup: type a guessed meter number, learn whether somebody else has registered
 *       it. The staff probe reads cross-owner collisions precisely because staff can be held to
 *       what they do with one; an owner cannot.</li>
 *   <li>A rejected or archived listing must not block, or an owner whose listing was refused is
 *       locked out of re-listing the flat they still own, with a "you already listed this" that
 *       points at something they cannot use.</li>
 *   <li>Both signals absent must answer cleanly rather than matching anything, because that is the
 *       common case — most listings carry no meter number — and a rule that fires on emptiness
 *       fires on everybody.</li>
 * </ul>
 *
 * <p>Listings are created through {@code POST /me/listings} rather than the repository on purpose:
 * the whole claim of the endpoint is that it derives the same key the create derives, and a fixture
 * that sets {@code addressKey} by hand would assert that claim against itself.
 */
@DisplayName("Listings — have I already listed this property?")
class OwnListingDuplicateCheckTest extends AbstractApiTest {

    private static final String PATH = "/me/listings/duplicate-check";

    /** One doorway, written the way the wizard writes it. */
    private static final String ADDRESS = "Flat 402, B Wing, Rohan Nilay";
    /** The same doorway as somebody else would write it — sorted tokens, fillers dropped. */
    private static final String ADDRESS_REPHRASED = "B-402, Rohan Nilay Society, Baner, Pune 411045";
    private static final String METER = "MSEDCL-170004488";

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Duplicate Owner");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** A create body carrying whichever duplicate signals the case is about. */
    private String listingBody(String address, String meter) {
        return """
                {
                  "title": "Bright 2BHK in Baner",
                  "deal": "rent",
                  "propertyType": "apartment",
                  "price": 25000,
                  "bhk": 2,
                  "locality": "Baner",
                  "city": "Pune"
                  %s
                  %s
                }
                """.formatted(
                address == null ? "" : ", \"address\": \"" + address + "\"",
                meter == null ? "" : ", \"electricityMeterNo\": \"" + meter + "\"");
    }

    private String checkBody(String address, String meter) {
        return """
                {
                  "locality": "Baner",
                  "city": "Pune"
                  %s
                  %s
                }
                """.formatted(
                address == null ? "" : ", \"address\": \"" + address + "\"",
                meter == null ? "" : ", \"electricityMeterNo\": \"" + meter + "\"");
    }

    /** The house way to pull one field out of a response body without a parser. */
    private String field(String json, String name) {
        return json.replaceAll("^.*?\"" + name + "\":\"([^\"]+)\".*$", "$1");
    }

    private UUID createListing(User o, String address, String meter) throws Exception {
        String body = mvc.perform(post("/me/listings")
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(listingBody(address, meter)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(field(body, "id"));
    }

    @Test
    @DisplayName("the meter number finds the listing the owner already has")
    void meterMatchesOwnListing() throws Exception {
        User o = owner("9876511001");
        UUID existing = createListing(o, ADDRESS, METER);

        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(null, METER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(true))
                .andExpect(jsonPath("$.existingId").value(existing.toString()));
    }

    @Test
    @DisplayName("the id handed back resolves — it is a server listing, not a browser's idea of one")
    void theIdItReturnsIsRealAndTheOwnersOwn() throws Exception {
        User o = owner("9876511002");
        createListing(o, ADDRESS, METER);

        String verdict = mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(null, METER)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String existingId = field(verdict, "existingId");

        // The "edit the one you already have" link the wizard offers goes here. If this 404s, the
        // guard has sent an owner to a blank form and told them it was their listing.
        mvc.perform(get("/me/listings/" + existingId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("the same doorway written differently still matches — the key is normalised, not the string")
    void addressMatchesAcrossRewordings() throws Exception {
        User o = owner("9876511003");
        UUID existing = createListing(o, ADDRESS, null);

        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(ADDRESS_REPHRASED, null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(true))
                .andExpect(jsonPath("$.existingId").value(existing.toString()));
    }

    @Test
    @DisplayName("somebody else's identical listing is invisible here")
    void anotherOwnersListingIsNeverReported() throws Exception {
        User stranger = owner("9876511004");
        createListing(stranger, ADDRESS, METER);
        User o = owner("9876511005");

        // Both signals point at a real listing. It is not this caller's, so as far as this endpoint
        // is concerned it does not exist — otherwise a guessed meter number becomes a way to ask the
        // platform who else has registered it.
        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(ADDRESS, METER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(false))
                .andExpect(jsonPath("$.existingId").doesNotExist());
    }

    @Test
    @DisplayName("a rejected listing does not lock the owner out of re-listing the flat")
    void rejectedOwnListingDoesNotBlock() throws Exception {
        User o = owner("9876511006");
        UUID id = createListing(o, ADDRESS, METER);
        Property p = properties.findById(id).orElseThrow();
        p.setStatus(PropertyStatus.REJECTED);
        properties.saveAndFlush(p);

        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(ADDRESS, METER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(false));
    }

    @Test
    @DisplayName("an archived listing does not block either — the owner took it down themselves")
    void archivedOwnListingDoesNotBlock() throws Exception {
        User o = owner("9876511007");
        UUID id = createListing(o, ADDRESS, METER);
        Property p = properties.findById(id).orElseThrow();
        p.archive("owner took it down");
        properties.saveAndFlush(p);

        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(ADDRESS, METER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(false));
    }

    @Test
    @DisplayName("with neither signal it answers no, rather than matching everything")
    void noSignalsIsACleanNo() throws Exception {
        User o = owner("9876511008");
        createListing(o, ADDRESS, METER);

        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(null, null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(false));
    }

    @Test
    @DisplayName("an empty meter number matches nothing, not everything that also has none")
    void blankMeterIsNotASignal() throws Exception {
        User o = owner("9876511009");
        createListing(o, null, null);

        // `= ''` is a match in SQL where `= null` is not. Without the blank-to-null guard this
        // caller would collide with every listing they have that carries no meter.
        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(null, "")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(false));
    }

    @Test
    @DisplayName("the same meter written with spaces or dashes still matches — V79 was wrong that it has one spelling")
    void meterMatchesAcrossGroupings() throws Exception {
        User o = owner("9876511012");
        // Stored the way a bill prints it. The owner is shown this string back and checks it against
        // that bill, so the raw column keeps the grouping; only the comparison key drops it.
        UUID existing = createListing(o, null, "1700 4455 6677");

        // Typed the way somebody types a number from memory. V79 introduced this arm under the note
        // that a meter "has one spelling", and compared the raw column on the strength of it — so
        // these three were three different meters and the arm that exists *because* it is certain
        // was the one silently missing its matches.
        for (String spelling : new String[] {"170044556677", "1700-4455-6677", " 1700  4455 6677 "}) {
            mvc.perform(post(PATH)
                            .header(HttpHeaders.AUTHORIZATION, bearer(o))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(checkBody(null, spelling)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.found").value(true))
                    .andExpect(jsonPath("$.existingId").value(existing.toString()));
        }

        // The counter-anchor, and the reason the loop above is a normalisation test rather than a
        // "the meter arm fires" test: one digit different is a different meter. Without this, a key
        // that collapsed to a constant would satisfy every assertion above.
        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(null, "170044556678")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(false));
    }

    @Test
    @DisplayName("a meter number too short to be one is no signal, on either side")
    void aTooShortMeterIsNotASignal() throws Exception {
        User o = owner("9876511013");
        // "1" is what a placeholder looks like, and two owners who both typed a placeholder have not
        // told us they own the same flat. Both the stored value and the query normalise to no key,
        // so this is a clean no rather than a collision manufactured out of two people's shrugs.
        createListing(o, null, "1");

        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(null, "1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(false));
    }

    @Test
    @DisplayName("a different flat in the same building is not a duplicate")
    void aDifferentUnitIsNotADuplicate() throws Exception {
        User o = owner("9876511010");
        createListing(o, ADDRESS, null);

        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody("Flat 403, B Wing, Rohan Nilay", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(false));
    }

    @Test
    @DisplayName("an over-long meter number is refused rather than truncated into somebody's key")
    void oversizeMeterIsRejected() throws Exception {
        User o = owner("9876511011");

        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(null, "M".repeat(65))))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("a signed-out caller has no listings to ask about")
    void anonymousIsRefused() throws Exception {
        mvc.perform(post(PATH)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(ADDRESS, METER)))
                .andExpect(status().isUnauthorized());
    }
}
