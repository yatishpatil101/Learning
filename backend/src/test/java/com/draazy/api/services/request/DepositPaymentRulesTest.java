package com.draazy.api.services.request;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.error.ValidationException;
import java.time.LocalDate;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Rent agreement deposit payments: what the IGR portal asks for, adding up to the deposit")
class DepositPaymentRulesTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 4, 1);

    private static final Map<String, Object> UPI = Map.of("mode", "upi", "ref", "612345678901", "amount", "60000",
            "date", "2026-03-30");
    private static final Map<String, Object> DD = Map.of("mode", "dd", "bank", "HDFC Bank", "branch", "Baner",
            "ref", "004512", "amount", "30000", "date", "2026-03-28");
    private static final Map<String, Object> NETBANKING = Map.of("mode", "netbanking", "bank", "State Bank of India",
            "ref", "SBIN52026032812345678", "amount", "5000", "date", "2026-03-28");
    private static final Map<String, Object> CASH = Map.of("mode", "cash", "amount", "5000", "date", "2026-04-01");

    @Test
    @DisplayName("all four modes together may make up the deposit")
    void everyMode() {
        assertThatCode(() -> check("100000", List.of(UPI, DD, NETBANKING, CASH))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a request without payments is still accepted; the wizard asks for them")
    void absentIsAccepted() {
        assertThatCode(() -> check("100000", null)).doesNotThrowAnyException();
        assertThatCode(() -> check("100000", List.of())).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("payments that do not add up to the deposit are refused")
    void mustAddUp() {
        assertThatThrownBy(() -> check("100000", List.of(UPI)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("must add up to _state.terms.deposit");
        assertThatThrownBy(() -> check("0", List.of(CASH)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("must add up");
    }

    @Test
    @DisplayName("each mode needs its own fields, a clean reference and a date not in the future")
    void fieldsPerMode() {
        assertThatThrownBy(() -> check("5000", List.of(Map.of("mode", "netbanking", "amount", "5000"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("[0].bank is required")
                .hasMessageContaining("[0].ref is required")
                .hasMessageContaining("[0].date is required");
        assertThatThrownBy(() -> check("60000", List.of(withRef("UTR 12-34"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("[0].ref must be 4 to 30 letters or digits");
        assertThatThrownBy(() -> check("5000", List.of(Map.of("mode", "cash", "amount", "5000", "date", "2026-04-02"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("[0].date must not be after today");
        assertThatThrownBy(() -> check("5000", List.of(Map.of("mode", "crypto", "amount", "5000"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("[0].mode must be one of");
        assertThatThrownBy(() -> check("0", List.of(Map.of("mode", "cash", "amount", "0", "date", "2026-04-01"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("[0].amount must be a whole number");
    }

    @Test
    @DisplayName("the list is bounded and must hold payment rows")
    void shape() {
        assertThatThrownBy(() -> check("55000", Collections.nCopies(11, CASH)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("at most 10 rows");
        assertThatThrownBy(() -> check("5000", "cash"))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("must be a list of payments");
    }

    private static Map<String, Object> withRef(String ref) {
        return Map.of("mode", "upi", "ref", ref, "amount", "60000", "date", "2026-03-30");
    }

    private static void check(String deposit, Object payments) {
        Map<String, Object> terms = new java.util.HashMap<>(Map.of("deposit", deposit));
        terms.put("depositPayments", payments);
        RentAgreementDetailsRules.check(Map.of("_state", Map.of("terms", terms)), TODAY);
    }
}
