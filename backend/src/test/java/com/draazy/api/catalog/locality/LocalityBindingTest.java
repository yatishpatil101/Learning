package com.draazy.api.catalog.locality;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.error.ValidationException;
import com.draazy.api.support.AbstractApiTest;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("LocalityBinding: a record is tied to a live locality the user picked")
class LocalityBindingTest extends AbstractApiTest {

    private static final String PICK = "Pick the locality from the suggestions.";

    @Autowired LocalityBinding binding;

    @BeforeEach
    void rows() {
        insert("zzbind-live", "Zzbind Live", false);
        insert("zzbind-gone", "Zzbind Gone", true);
        insert("zzbind-twin-a", "Zzbind Twin", false);
        insert("zzbind-twin-b", "ZZBIND TWIN", false);
    }

    private void insert(String slug, String name, boolean archived) {
        jdbc.update("insert into localities (slug, name, city, lat, lng, active, archived_at) "
                + "values (?, ?, 'Pune', 18.5, 73.8, ?, " + (archived ? "now()" : "null") + ")",
                slug, name, !archived);
    }

    @Test
    void aTypedNameMatchesTheLiveLocalityIgnoringCase() {
        var bound = binding.require(null, "  zzbind live ");

        assertThat(bound.slug()).isEqualTo("zzbind-live");
        assertThat(bound.name()).isEqualTo("Zzbind Live");
    }

    @Test
    void anUnknownRetiredOrAmbiguousNameIsRefused() {
        for (String name : new String[] {"Nowhere", "Zzbind Gone", "Zzbind Twin", "", null}) {
            assertThatThrownBy(() -> binding.require(null, name))
                    .isInstanceOf(ValidationException.class).hasMessage(PICK);
        }
    }

    @Test
    void aSlugWinsOverTheNameAndMustBeLive() {
        assertThat(binding.require("zzbind-live", "whatever").name()).isEqualTo("Zzbind Live");

        assertThatThrownBy(() -> binding.require("zzbind-gone", "Zzbind Live"))
                .isInstanceOf(ValidationException.class).hasMessage(PICK);
        assertThatThrownBy(() -> binding.require("missing", "Zzbind Live"))
                .isInstanceOf(ValidationException.class).hasMessage(PICK);
    }

    @Test
    void aSlugResolvesAnAmbiguousName() {
        assertThat(binding.require("zzbind-twin-b", "Zzbind Twin").slug()).isEqualTo("zzbind-twin-b");
        assertThat(binding.canonicalName("zzbind-twin-a", "Zzbind Twin")).isEqualTo("Zzbind Twin");
    }

    @Test
    void aFlatmateNameFromARetiredSlugPassesOnlyWhenAlreadyStored() {
        assertThat(binding.canonicalName("zzbind-gone", "x", List.of("Zzbind Gone"))).isEqualTo("Zzbind Gone");

        assertThatThrownBy(() -> binding.canonicalName("zzbind-gone", "Zzbind Gone", List.of()))
                .isInstanceOf(ValidationException.class).hasMessage(PICK);
    }

    @Test
    void anEditMayKeepItsRetiredBindingButNotMoveToAnotherRetiredOne() {
        assertThat(binding.require("zzbind-gone", null, "zzbind-gone").slug()).isEqualTo("zzbind-gone");

        assertThatThrownBy(() -> binding.require("zzbind-gone", null, "zzbind-live"))
                .isInstanceOf(ValidationException.class).hasMessage(PICK);
    }

    @Test
    void namesInAListAreCanonicalisedAndStoredOnesSurviveRetirement() {
        assertThat(binding.canonicalNames(List.of("zzbind live", "Zzbind Live"))).containsExactly("Zzbind Live");
        assertThat(binding.canonicalNames(List.of("Zzbind Gone", "zzbind live"), List.of("Zzbind Gone")))
                .containsExactly("Zzbind Gone", "Zzbind Live");

        assertThatThrownBy(() -> binding.canonicalNames(List.of("Zzbind Gone")))
                .isInstanceOf(ValidationException.class).hasMessage(PICK);
    }

    @Test
    void slugOrNullNeverThrows() {
        assertThat(binding.slugOrNull(null, "zzbind live")).isEqualTo("zzbind-live");
        assertThat(binding.slugOrNull("zzbind-twin-a", "Zzbind Twin")).isEqualTo("zzbind-twin-a");
        assertThat(binding.slugOrNull("zzbind-gone", null)).isNull();
        assertThat(binding.slugOrNull(null, "Zzbind Twin")).isNull();
        assertThat(binding.slugOrNull(null, null)).isNull();
    }
}
