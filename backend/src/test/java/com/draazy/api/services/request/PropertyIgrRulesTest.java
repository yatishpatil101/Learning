package com.draazy.api.services.request;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.error.ValidationException;
import java.time.LocalDate;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Rent agreement property IGR particulars")
class PropertyIgrRulesTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 4, 1);

    @Test
    @DisplayName("requests filed before IGR property fields existed still pass")
    void absentValuesPass() {
        assertThatCode(() -> state(Map.of("prop", Map.of("area", "850"), "terms", Map.of("parking", "none"))))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a stated taluka and village must be usable on the IGR portal")
    void talukaAndVillage() {
        assertThatCode(() -> state(Map.of("prop", Map.of("taluka", "Haveli", "villageCity", "Baner"))))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> state(Map.of("prop", Map.of("taluka", "", "villageCity", ""))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.prop.taluka")
                .hasMessageContaining("_state.prop.villageCity");
        assertThatThrownBy(() -> state(Map.of("prop", Map.of("taluka", "Mumbai", "villageCity", "Baner"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.prop.taluka");
    }

    @Test
    @DisplayName("property attribute rows carry a known kind and a bounded number")
    void attributes() {
        assertThatCode(() -> state(Map.of("prop", Map.of("propertyAttributes",
                java.util.List.of(Map.of("kind", "CTS No.", "number", "1234/5A"),
                        Map.of("kind", "Survey No.", "number", "88")))))).doesNotThrowAnyException();
        assertThatThrownBy(() -> state(Map.of("prop", Map.of("propertyAttributes",
                java.util.List.of(Map.of("kind", "Mutation No.", "number", "123"))))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.prop.propertyAttributes[0].kind");
        assertThatThrownBy(() -> state(Map.of("prop", Map.of("propertyAttributes",
                java.util.List.of(Map.of("kind", "CTS No."))))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.prop.propertyAttributes[0].number");
    }

    @Test
    @DisplayName("parking and gallery areas are optional but sane when stated")
    void optionalAreas() {
        assertThatCode(() -> state(Map.of("prop", Map.of("galleryArea", "45.5", "galleryAreaUnit", "sqft"),
                "terms", Map.of("parking", "car", "parkingArea", "120", "parkingAreaUnit", "sqm"))))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> state(Map.of("prop", Map.of("galleryArea", "0"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.prop.galleryArea");
        assertThatThrownBy(() -> state(Map.of("terms", Map.of("parking", "none", "parkingArea", "120"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.terms.parkingArea requires parking");
        assertThatThrownBy(() -> state(Map.of("terms", Map.of("parkingAreaUnit", "guntha"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.terms.parkingAreaUnit");
    }

    private static void state(Map<String, Object> state) {
        RentAgreementDetailsRules.check(Map.of("_state", state), TODAY);
    }
}
