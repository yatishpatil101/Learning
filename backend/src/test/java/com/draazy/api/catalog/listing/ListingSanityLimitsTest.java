package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.math.BigDecimal;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

class ListingSanityLimitsTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void acceptsBoundaryValues() {
        assertThat(fields(create("buy", "Flat", 100_000L, null, "100", "100", "100"))).isEmpty();
        assertThat(fields(create("rent", "apartment", 1_000L, 24_000L, "20000", "21000", "22000"))).isEmpty();
    }

    @Test
    void rejectsSalePriceBelowOneLakh() {
        assertThat(fields(create("buy", "Flat", 99_999L, null, "100", null, null)))
                .containsExactly("price");
    }

    @Test
    void rejectsRentBelowOneThousandAndDepositAboveTwoYears() {
        assertThat(fields(create("rent", "Flat", 999L, 24_001L, "100", null, null)))
                .containsExactlyInAnyOrder("price", "deposit");
    }

    @Test
    void rejectsResidentialCarpetAreaJustOutsideBounds() {
        assertThat(fields(create("buy", "Flat", 100_000L, null, "99.99", null, null)))
                .containsExactly("carpetArea");
        assertThat(fields(create("buy", "villa", 100_000L, null, "20000.01", null, null)))
                .containsExactly("carpetArea");
    }

    @Test
    void rejectsResidentialBuiltUpAndSuperBuiltUpInversions() {
        assertThat(fields(create("buy", "Independent House", 100_000L, null, "1000", "999", null)))
                .containsExactly("builtUpArea");
        assertThat(fields(create("buy", "Flat", 100_000L, null, "1000", null, "999")))
                .containsExactly("superBuiltUpArea");
        assertThat(fields(create("buy", "Flat", 100_000L, null, "1000", "1100", "1099")))
                .containsExactly("superBuiltUpArea");
    }

    @Test
    void leavesCommercialAndLandAreaBoundsAlone() {
        assertThat(fields(create("buy", "Warehouse / Godown", 100_000L, null, "50", "40", "30")))
                .isEmpty();
        assertThat(fields(create("buy", "Open Plot", 100_000L, null, "50", null, null)))
                .isEmpty();
    }

    static Stream<Arguments> reraOptionalSales() {
        return Stream.of(
                Arguments.of("plottedProjectSaleKeepsReraOptional: null", plottedProject(null)),
                Arguments.of("plottedProjectSaleKeepsReraOptional: blank", plottedProject("")),
                Arguments.of("plottedProjectSaleKeepsReraOptional: given", plottedProject("P52100012345")),
                Arguments.of("plottedProjectLandSaleKeepsReraOptional",
                        create("buy", "Farm Land", 100_000L, null, "50", null, null,
                                null, Map.of("plottedProject", "yes"))),
                Arguments.of("nonProjectPlotSaleKeepsReraOptional",
                        create("buy", "Open Plot", 100_000L, null, "50", null, null)));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("reraOptionalSales")
    void plotAndLandSalesKeepReraOptional(String name, ListingCreate request) {
        assertThat(fields(request)).isEmpty();
    }

    @Test
    void updateOnlyChecksLimitsWhenThePatchContainsTheRelevantContext() {
        assertThat(fields(update(null, null, 85L, null, null, null, null))).isEmpty();
        assertThat(fields(update("buy", null, 85L, null, null, null, null))).containsExactly("price");
        assertThat(fields(update(null, "Flat", null, null, "99", null, null))).containsExactly("carpetArea");
        assertThat(fields(update(null, null, null, 50_000L, null, null, null))).isEmpty();
        assertThat(fields(update("rent", null, 1_000L, 24_001L, null, null, null))).containsExactly("deposit");
    }

    private java.util.List<String> fields(Object request) {
        return validator.validate(request).stream()
                .map(v -> v.getPropertyPath().toString())
                .sorted()
                .toList();
    }

    private static ListingCreate create(String deal, String propertyType, Long price, Long deposit,
            String carpetArea, String builtUpArea, String superBuiltUpArea) {
        return new ListingCreate("Boundary listing", deal, propertyType, BigDecimal.TWO, price,
                deposit, null, null, bd(carpetArea), "sqft", null, "Baner", "Pune",
                null, null, null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null, null, bd(carpetArea),
                bd(builtUpArea), bd(superBuiltUpArea), null, null, null, null);
    }

    private static ListingCreate create(String deal, String propertyType, Long price, Long deposit,
            String carpetArea, String builtUpArea, String superBuiltUpArea, String reraId,
            Map<String, Object> formDetails) {
        return new ListingCreate("Boundary listing", deal, propertyType, BigDecimal.TWO, price,
                deposit, null, null, bd(carpetArea), "sqft", null, "Baner", "Pune",
                null, null, reraId, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null, null, null, bd(carpetArea),
                bd(builtUpArea), bd(superBuiltUpArea), null, null, formDetails, null);
    }

    private static ListingCreate plottedProject(String reraId) {
        return new ListingCreate("Boundary listing", "buy", "Open Plot", BigDecimal.TWO, 100_000L,
                null, null, null, bd("50"), "sqft", null, "Baner", "Pune",
                null, null, reraId, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null, null, null, bd("50"),
                null, null, null, null, Map.of("plottedProject", "yes"), null);
    }

    private static ListingUpdate update(String deal, String propertyType, Long price, Long deposit,
            String carpetArea, String builtUpArea, String superBuiltUpArea) {
        return new ListingUpdate(null, deal, propertyType, null, price, deposit, null, null,
                null, null, null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, bd(carpetArea), bd(builtUpArea), bd(superBuiltUpArea), null,
                null, null, null, null, null);
    }

    private static BigDecimal bd(String value) {
        return value == null ? null : new BigDecimal(value);
    }
}
