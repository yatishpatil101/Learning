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
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

// Boundary cases prove this owner convenience cannot become a lookup
// for somebody else's registered meter or address.
@DisplayName("Listings — have I already listed this property?")
class OwnListingDuplicateCheckTest extends AbstractApiTest {

    private static final String PATH = "/me/listings/duplicate-check";

    private static final String ADDRESS = "Flat 402, B Wing, Rohan Nilay";

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

    private String listingBody(User owner, String address, String meter) {
        return """
                {
                  "title": "Bright 2BHK in Baner",
                  "deal": "rent",
                  "propertyType": "apartment",
                  "price": 25000,
                  "bhk": 2,
                  "locality": "Baner",
                  "city": "Pune",
                  %s
                  %s
                  %s
                }
                """.formatted(
                listingImages(owner),
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
                        .content(listingBody(o, address, meter)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(field(body, "id"));
    }

    @Test
    @DisplayName("the id handed back resolves — it is a server listing, not a browser's idea of one")
    void theIdItReturnsIsRealAndTheOwnersOwn() throws Exception {
        User o = owner("9876511002");
        UUID existing = createListing(o, ADDRESS, METER);

        String verdict = mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(null, METER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(true))
                .andExpect(jsonPath("$.existingId").value(existing.toString()))
                .andReturn().getResponse().getContentAsString();
        String existingId = field(verdict, "existingId");

        // The "edit the one you already have" link the wizard offers goes here.
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

        // A guessed meter must not reveal whether another owner registered it.
        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(ADDRESS, METER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(false))
                .andExpect(jsonPath("$.existingId").doesNotExist());
    }

    static Stream<Arguments> freedOwnListingStates() {
        return Stream.of(
                Arguments.of("rejectedOwnListingDoesNotBlock",
                        (Consumer<Property>) p -> p.setStatus(PropertyStatus.REJECTED)),
                Arguments.of("archivedOwnListingDoesNotBlock",
                        (Consumer<Property>) p -> p.archive("owner took it down")));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("freedOwnListingStates")
    @DisplayName("a rejected or archived listing does not lock the owner out of re-listing the flat")
    void aFreedOwnListingDoesNotBlock(String name, Consumer<Property> mutate) throws Exception {
        User o = owner("9876511006");
        UUID existing = createListing(o, ADDRESS, METER);
        Property p = properties.findById(existing).orElseThrow();
        mutate.accept(p);
        properties.saveAndFlush(p);

        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(ADDRESS, METER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(false));
    }

    @Test
    @DisplayName("a paused listing still blocks the owner from re-listing the same flat")
    void pausedOwnListingStillBlocks() throws Exception {
        User o = owner("9876511014");
        UUID existing = createListing(o, ADDRESS, METER);
        Property p = properties.findById(existing).orElseThrow();
        p.setStatus(PropertyStatus.PAUSED);
        properties.saveAndFlush(p);

        mvc.perform(post(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(checkBody(ADDRESS, METER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.found").value(true))
                .andExpect(jsonPath("$.existingId").value(existing.toString()));
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

        // Typed the way somebody types a number from memory.
        for (String spelling : new String[] {"170044556677", "1700-4455-6677", " 1700  4455 6677 "}) {
            mvc.perform(post(PATH)
                            .header(HttpHeaders.AUTHORIZATION, bearer(o))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(checkBody(null, spelling)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.found").value(true))
                    .andExpect(jsonPath("$.existingId").value(existing.toString()));
        }

        // Counter-anchor: one digit different is a different meter,
        // so a constant key cannot satisfy every assertion above.
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
