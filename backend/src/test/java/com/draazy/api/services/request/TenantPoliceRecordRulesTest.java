package com.draazy.api.services.request;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.error.ValidationException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Rent agreement tenant police records: what the IGR portal asks for licensees")
class TenantPoliceRecordRulesTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 4, 1);
    private static final Map<String, Object> PERMANENT = Map.of("address", "44, FC Road, Pune",
            "pincode", "411004", "village", "Shivajinagar", "policeStation", "Deccan Police Station");
    private static final Map<String, Object> FAMILY = Map.of("type", "family", "relation", "spouse",
            "fullName", "Sneha Nair", "age", "29", "mobile", "9876543210");
    private static final Map<String, Object> POLICE = Map.of(
            "permanentSameAsCurrent", false,
            "permanent", PERMANENT,
            "addressProofType", "uid",
            "previousSameAsPermanent", true,
            "workplaceAddress", "Draazy Labs, Baner, Pune 411045",
            "workIdProofType", "Employee ID",
            "occupants", List.of(FAMILY));

    @Test
    @DisplayName("old requests without the section still pass")
    void absentIsAccepted() {
        assertThatCode(() -> state(Map.of("tenants", List.of(Map.of("age", "31")))))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a realistic police record with family mobile, addresses and work proof passes")
    void realisticValues() {
        assertThatCode(() -> state(Map.of("tenants", List.of(tenant(POLICE))))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("required address and work fields are named")
    void requiredFields() {
        Map<String, Object> police = Map.of("permanentSameAsCurrent", false, "permanent", Map.of(),
                "addressProofType", "uid", "workplaceAddress", "", "workIdProofType", "");
        assertThatThrownBy(() -> state(Map.of("tenants", List.of(tenant(police)))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.tenants[0].police.permanent.address")
                .hasMessageContaining("_state.tenants[0].police.permanent.pincode")
                .hasMessageContaining("_state.tenants[0].police.workplaceAddress")
                .hasMessageContaining("_state.tenants[0].police.workIdProofType");
    }

    @Test
    @DisplayName("a previous address carries its own proof type when it differs")
    void previousAddressProof() {
        Map<String, Object> police = new java.util.HashMap<>(POLICE);
        police.put("previousSameAsPermanent", false);
        police.put("previous", PERMANENT);
        police.put("previousAddressProofType", "passport");
        assertThatCode(() -> state(Map.of("tenants", List.of(tenant(police))))).doesNotThrowAnyException();
        police.put("previousAddressProofType", "");
        assertThatThrownBy(() -> state(Map.of("tenants", List.of(tenant(police)))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.tenants[0].police.previousAddressProofType");
    }

    @Test
    @DisplayName("students, homemakers and retired tenants need not state workplace details")
    void workOptionalForNonWorkingOccupations() {
        assertThatCode(() -> state(Map.of("tenants", List.of(Map.of("age", "31", "occupation", "Student",
                "police", Map.of("addressProofType", "passport")))))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("co-fill tenant side carries the police record inside the tenant row")
    void coFillCarriesTenantPoliceRecord() {
        Map<String, Object> details = CoFillServiceRequests.ownSide(ServiceRequestTypes.RENT_AGREEMENT,
                "tenant", 0, Map.of("_state", Map.of("tenants", List.of(Map.of()))),
                Map.of("_state", Map.of("tenants", List.of(tenant(POLICE)))));
        Map<?, ?> state = (Map<?, ?>) details.get("_state");
        List<?> tenants = (List<?>) state.get("tenants");
        Map<?, ?> merged = (Map<?, ?>) tenants.get(0);
        assertThat(((Map<?, ?>) merged.get("police")).get("workIdProofType")).isEqualTo("Employee ID");
    }

    private static Map<String, Object> tenant(Map<String, Object> police) {
        return Map.of("age", "31", "occupation", "Software Engineer", "police", police);
    }

    private static void state(Map<String, Object> state) {
        RentAgreementDetailsRules.check(Map.of("_state", state), TODAY);
    }
}
