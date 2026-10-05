package com.draazy.api.services.request;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.error.ValidationException;
import java.time.LocalDate;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Rent agreement party identity: portal DOB and mother's-name fields")
class PartyIdentityRulesTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 4);

    @Test
    @DisplayName("new identity fields are validated when present, while older requests without them still pass")
    void validAndAbsent() {
        assertThatCode(() -> RentAgreementDetailsRules.check(Map.of("_state", Map.of("owner", Map.of())), TODAY))
                .doesNotThrowAnyException();

        assertThatCode(() -> RentAgreementDetailsRules.check(Map.of("_state", Map.of(
                "owner", Map.of("oMother", "Shaila Verma", "oDob", "1980-01-01", "oAlias", "Anu",
                        "oAge", "46", "capacity", "co-owner"),
                "coOwners", java.util.List.of(Map.of("mother", "Meera Verma", "dob", "1977-05-15",
                        "alias", "Vikram V", "age", "49")),
                "tenants", java.util.List.of(Map.of("mother", "Latha Nair", "dob", "1995-01-01",
                        "alias", "Rahul", "age", "31")))), TODAY)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("DOB must be ISO, adult and agree with the age snapshot")
    void dobRules() {
        assertThatThrownBy(() -> RentAgreementDetailsRules.check(Map.of("_state", Map.of(
                "owner", Map.of("oDob", "2010-01-01", "oAge", "16"),
                "tenants", java.util.List.of(Map.of("dob", "not-a-date", "age", "31")),
                "coOwners", java.util.List.of(Map.of("dob", "1977-05-15", "age", "48")))), TODAY))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.owner.oDob must make the party 18 to 150 years old")
                .hasMessageContaining("_state.tenants[0].dob must be an ISO date yyyy-MM-dd")
                .hasMessageContaining("_state.coOwners[0].age must match _state.coOwners[0].dob");
    }

    @Test
    @DisplayName("mother's name and alias stay bounded so details json remains small")
    void textBounds() {
        String tooLong = "x".repeat(81);
        assertThatThrownBy(() -> RentAgreementDetailsRules.check(Map.of("_state", Map.of(
                "owner", Map.of("oMother", tooLong, "oAlias", tooLong))), TODAY))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.owner.oMother must be at most 80 characters")
                .hasMessageContaining("_state.owner.oAlias must be at most 80 characters");
    }
}
