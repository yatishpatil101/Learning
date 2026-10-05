package com.draazy.api.services.request;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.error.ValidationException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Rent agreement terms: the cross-field rules at their edges")
class RentAgreementDetailsRulesTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 4, 1);

    @Test
    @DisplayName("the start date may be 30 days back or 180 ahead, and no further")
    void startDateWindow() {
        assertThatCode(() -> check(Map.of("startDate", "2026-03-02"))).doesNotThrowAnyException();
        assertThatCode(() -> check(Map.of("startDate", "2026-09-28"))).doesNotThrowAnyException();
        assertThatThrownBy(() -> check(Map.of("startDate", "2026-03-01")))
                .isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> check(Map.of("startDate", "2026-09-29")))
                .isInstanceOf(ValidationException.class);
    }

    @Test
    @DisplayName("a lock-in or notice as long as the term is allowed; one month longer is not")
    void withinTheTerm() {
        assertThatCode(() -> check(Map.of("months", "60", "lockin", "60", "notice", "60")))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> check(Map.of("months", "11", "lockin", "12")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.terms.lockin");
    }

    @Test
    @DisplayName("every broken rule is named in one answer")
    void reportsEveryProblem() {
        assertThatThrownBy(() -> check(Map.of("months", "0", "dueDay", "0", "increment", "-1")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.terms.months")
                .hasMessageContaining("_state.terms.dueDay")
                .hasMessageContaining("_state.terms.increment");
    }

    @Test
    @DisplayName("rent falls due on a day every month has, and a tenancy may carry no deposit")
    void dueDayAndZeroDeposit() {
        assertThatCode(() -> check(Map.of("dueDay", "28", "deposit", "0"))).doesNotThrowAnyException();
        assertThatThrownBy(() -> check(Map.of("dueDay", "29")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.terms.dueDay must be an integer from 1 to 28");
    }

    @Test
    @DisplayName("the rent rises every 11 or 12 months, by at most two decimals of a percent")
    void escalation() {
        assertThatCode(() -> check(Map.of("increment", "5", "incrementEvery", "11")))
                .doesNotThrowAnyException();
        assertThatCode(() -> check(Map.of("increment", "2.5", "incrementEvery", 12)))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> check(Map.of("incrementEvery", "6")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.terms.incrementEvery");
        assertThatThrownBy(() -> check(Map.of("increment", "5.125")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.terms.increment");
    }

    @Test
    @DisplayName("what the wizard has not stated yet is not refused")
    void absentValuesPass() {
        assertThatCode(() -> RentAgreementDetailsRules.check(null, TODAY)).doesNotThrowAnyException();
        assertThatCode(() -> RentAgreementDetailsRules.check(Map.of(), TODAY)).doesNotThrowAnyException();
        assertThatCode(() -> check(Map.of("months", "", "lockin", ""))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a minor witness or a malformed email is refused; an adult and a real address pass")
    void partiesAndEmail() {
        assertThatCode(() -> state(Map.of(
                "wit", Map.of("w1Name", "Meera", "w2Name", "Sunil", "w1Age", "18", "w2Age", 120),
                "owner", Map.of("oEmail", " owner@example.in "),
                "tenants", List.of(Map.of("email", "tenant@example.in"))))).doesNotThrowAnyException();
        assertThatThrownBy(() -> state(Map.of("wit", Map.of("w1Age", "17"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.wit.w1Age");
        assertThatThrownBy(() -> state(Map.of("owner", Map.of("oEmail", "owner@example"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.owner.oEmail");
        assertThatThrownBy(() -> state(Map.of("tenants", List.of(Map.of("email", "tenant@example")))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.tenants[0].email");
    }

    @Test
    @DisplayName("a minor licensor or licensee is refused, since a minor's agreement is void")
    void partiesAreAdults() {
        assertThatCode(() -> state(Map.of("owner", Map.of("oAge", "18"),
                "tenants", List.of(Map.of("age", "64"))))).doesNotThrowAnyException();
        assertThatThrownBy(() -> state(Map.of("owner", Map.of("oAge", "17"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.owner.oAge");
        assertThatThrownBy(() -> state(Map.of("coOwners", List.of(Map.of("age", "16")))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.coOwners[0].age");
        assertThatThrownBy(() -> state(Map.of("tenants", List.of(Map.of("age", "12")))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.tenants[0].age");
    }

    @Test
    @DisplayName("the flat's area, its basis and unit, and the floor are what a deed can describe")
    void propertyDescription() {
        assertThatCode(() -> state(Map.of("prop", Map.of("area", "850.5", "areaBasis", "built-up",
                "areaUnit", "sqm", "floor", "0")))).doesNotThrowAnyException();
        for (Map<String, Object> prop : List.<Map<String, Object>>of(Map.of("area", "0"),
                Map.of("area", "100001"), Map.of("area", "12.345"), Map.of("areaBasis", "super"),
                Map.of("areaUnit", "guntha"), Map.of("floor", "201"))) {
            assertThatThrownBy(() -> state(Map.of("prop", prop)))
                    .isInstanceOf(ValidationException.class)
                    .hasMessageContaining("_state.prop." + prop.keySet().iterator().next());
        }
    }

    @Test
    @DisplayName("who-pays, parking and occupant clauses accept only the wizard's own options")
    void deedClauseOptions() {
        assertThatCode(() -> state(Map.of("terms", Map.of("utilitiesBy", "Tenant", "taxBy", "Owner",
                "costBy", "Split", "parking", "car", "occupants", "4")))).doesNotThrowAnyException();
        assertThatThrownBy(() -> state(Map.of("terms", Map.of("costBy", "Broker"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.terms.costBy");
        assertThatThrownBy(() -> state(Map.of("terms", Map.of("taxBy", "Split"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.terms.taxBy");
        assertThatThrownBy(() -> state(Map.of("terms", Map.of("parking", "helipad"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.terms.parking");
        assertThatThrownBy(() -> state(Map.of("terms", Map.of("occupants", "0"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.terms.occupants");
    }

    @Test
    @DisplayName("more signatories than the identity rows can hold are refused")
    void partyCap() {
        Map<String, Object> party = Map.of("age", "30");
        assertThatCode(() -> state(Map.of("owner", Map.of("capacity", "co-owner"),
                "coOwners", List.of(party, party, party),
                "tenants", List.of(party, party, party, party, party, party))))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> state(Map.of("coOwners", List.of(party, party, party, party))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.coOwners");
        assertThatThrownBy(() -> state(Map.of("tenants",
                List.of(party, party, party, party, party, party, party))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.tenants");
    }

    @Test
    @DisplayName("a deposit typed with commas is refused rather than charged as zero")
    void commaDepositIsNotZero() {
        assertThatThrownBy(() -> check(Map.of("deposit", "50,000")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("details.deposit must be a whole number");
        assertThatThrownBy(() -> check(Map.of("nrDeposit", "50,000")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("details.nrDeposit must be a whole number");
        assertThatThrownBy(() -> check(Map.of("rent", 32000.75)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("details.rent must be a whole number");
        assertThatThrownBy(() -> RentAgreementDetailsRules.check(Map.of("deposit", "50,000"), TODAY))
                .isInstanceOf(ValidationException.class);
    }

    @Test
    @DisplayName("the summary and the form must state the same priced terms")
    void copiesAgree() {
        assertThatThrownBy(() -> RentAgreementDetailsRules.check(Map.of("deposit", 0,
                "_state", Map.of("terms", Map.of("deposit", "50000"))), TODAY))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("differs");
        assertThatCode(() -> RentAgreementDetailsRules.check(Map.of("rent", 30000, "deposit", 50000,
                "months", "11", "_state", Map.of("terms", Map.of("rent", "30000", "deposit", "50000",
                        "nrDeposit", "", "months", "11"))), TODAY)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("witness names are required on create when the witness section is present")
    void witnessNamesOnCreate() {
        assertThatThrownBy(() -> state(Map.of("wit", Map.of("w1Name", "Meera"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.wit.w2Name");
        assertThatCode(() -> RentAgreementDetailsRules.check(
                Map.of("_state", Map.of("wit", Map.of("w1Name", ""))), TODAY, false))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("licensor capacity and POA execution fields are checked")
    void capacityAndPoa() {
        assertThatThrownBy(() -> state(Map.of("coOwners", List.of(Map.of("capacity", "co-owner")),
                "owner", Map.of("capacity", "owner"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.owner.capacity");
        assertThatThrownBy(() -> state(Map.of("owner", Map.of("capacity", "co-owner"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("without coOwners");
        assertThatThrownBy(() -> state(Map.of("owner", Map.of("capacity", "poa"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.owner.poaPrincipal")
                .hasMessageContaining("_state.owner.poaDate");
        assertThatThrownBy(() -> state(Map.of("owner", Map.of("capacity", "poa",
                "poaPrincipal", "Asha", "poaRegNo", "123", "poaSro", "Haveli 5",
                "poaDate", "2026-04-02"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.owner.poaDate");
    }

    @Test
    @DisplayName("NRI and foreign parties carry passport details instead of Aadhaar e-registration")
    void nonAadhaarParties() {
        assertThatCode(() -> state(Map.of("tenants", List.of(Map.of("residency", "nri",
                "passport", "Z1234567"))))).doesNotThrowAnyException();
        assertThatCode(() -> state(Map.of("tenants", List.of(Map.of("residency", "foreign",
                "passport", "X7654321", "visaOci", "OCI-123"))))).doesNotThrowAnyException();
        assertThatThrownBy(() -> state(Map.of("tenants", List.of(Map.of("residency", "nri")))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.tenants[0].passport");
        assertThatThrownBy(() -> state(Map.of("tenants", List.of(Map.of("residency", "foreign",
                "passport", "X7654321")))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.tenants[0].visaOci");
        assertThatThrownBy(() -> state(Map.of("owner", Map.of("type", "huf"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("_state.owner.type");
    }

    @Test
    @DisplayName("the flat is in Maharashtra: its pincode is in the 40-44 circle and not Goa's 403")
    void maharashtraPincode() {
        assertThatCode(() -> state(Map.of("prop", Map.of("pincode", "411045"))))
                .doesNotThrowAnyException();
        assertThatCode(() -> state(Map.of("prop", Map.of("pincode", "440001"))))
                .doesNotThrowAnyException();
        List.of("560001", "403001", "450001").forEach(pin ->
                assertThatThrownBy(() -> state(Map.of("prop", Map.of("pincode", pin))))
                        .as(pin)
                        .isInstanceOf(ValidationException.class)
                        .hasMessageContaining("_state.prop.pincode must be a Maharashtra pincode"));
    }

    private static void check(Map<String, Object> terms) {
        state(Map.of("terms", terms));
    }

    private static void state(Map<String, Object> state) {
        RentAgreementDetailsRules.check(Map.of("_state", state), TODAY);
    }
}
