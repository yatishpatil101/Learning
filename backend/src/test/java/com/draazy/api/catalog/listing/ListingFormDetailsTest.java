package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The only thing between the two wizards and the JSONB column, and its 422 names no field to the person filling the
 * form. The allowlist is mirrored in {@code frontend/src/lib/listingFormDetails.js}; drift there drops keys silently.
 */
@DisplayName("Listing form details — the allowlist that decides what survives the wire")
class ListingFormDetailsTest {

    private final ListingFormDetails.Validator validator = new ListingFormDetails.Validator();

    private boolean accepts(Map<String, Object> details) {
        return validator.isValid(details, null);
    }

    @Test
    @DisplayName("a null map is the owner answering nothing, not a malformed request")
    void nullIsValid() {
        assertThat(accepts(null)).isTrue();
    }

    @Test
    @DisplayName("a key outside the table is refused rather than stored unread")
    void unknownKeyRejected() {
        assertThat(accepts(Map.of("loadingFactor", "1.3"))).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"new", "resale", ""})
    @DisplayName("both sale types the wizards offer reach the column, and declining stays legal")
    void transactionTypeAccepted(String value) {
        assertThat(accepts(Map.of("transactionType", value))).isTrue();
    }

    @Test
    @DisplayName("a sale type no picker can produce is refused, so search never filters on a typo")
    void transactionTypeRejectsOffMenu() {
        assertThat(accepts(Map.of("transactionType", "Resale"))).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"included", "extra", ""})
    @DisplayName("maintenance terms, without which the detail page falls back to \"Ask Owner\"")
    void rentMaintModeAccepted(String value) {
        assertThat(accepts(Map.of("rentMaintMode", value))).isTrue();
    }

    @Test
    @DisplayName("the concierge desk's own commercial payload is accepted whole")
    void deskCommercialPayloadAccepted() {
        assertThat(accepts(Map.of(
                "society", "Blue Ridge Township",
                "landmark", "Near Hinjewadi Phase 1",
                "availableFrom", "2026-10-01",
                "commercialType", "warehouse",
                "shellType", "bareShell",
                "floorLoad", "4.5",
                "dockCount", "4",
                "suitableFor", List.of("Warehouse"),
                "fixtures", List.of("Loading Bay / Dock", "High Ceiling"),
                "powerBackup", true))).isTrue();
    }

    @Test
    @DisplayName("a landmark past its limit is refused, which is why the input caps at 60")
    void oversizedLandmarkRejected() {
        assertThat(accepts(Map.of("landmark", "x".repeat(61)))).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"5.", "12.345", "forty"})
    @DisplayName("a half-typed or over-precise spec is refused, so the desk trims before sending")
    void malformedDecimalRejected(String value) {
        assertThat(accepts(Map.of("floorLoad", value))).isFalse();
    }

    @Test
    @DisplayName("a five-digit year round-trips through LocalDate, so the length cap does the work")
    void oversizedDateRejected() {
        assertThat(accepts(Map.of("leaseExpiry", "+10000-01-01"))).isFalse();
    }

    @Test
    @DisplayName("a flag arriving as a string is refused rather than coerced to a claim")
    void flagMustBeBoolean() {
        assertThat(accepts(Map.of("powerBackup", "true"))).isFalse();
    }
}
