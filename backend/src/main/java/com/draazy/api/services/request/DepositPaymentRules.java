package com.draazy.api.services.request;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

// How the refundable deposit reached the licensor, as the IGR portal asks for it. Mirrors
// DEPOSIT_PAY_FIELDS in the wizard's constants.js.
final class DepositPaymentRules {

    static final int MAX_PAYMENTS = 10;
    static final int MAX_TEXT = 80;

    private static final Map<String, List<String>> REQUIRED = Map.of(
            "upi", List.of("ref", "amount", "date"),
            "netbanking", List.of("bank", "ref", "amount", "date"),
            "dd", List.of("bank", "date", "ref", "amount"),
            "cash", List.of("date", "amount"));
    private static final Set<String> TEXT = Set.of("bank", "branch");
    private static final Pattern REF = Pattern.compile("^[A-Za-z0-9]{4,30}$");
    private static final Pattern AMOUNT = Pattern.compile("^[0-9]{1,12}$");

    private DepositPaymentRules() {
    }

    // A bank reference on a row whose mode carries one — the only place a 12-digit run may be a UTR.
    static boolean isPaymentReference(Object row) {
        return row instanceof Map<?, ?> map && REQUIRED.getOrDefault(String.valueOf(map.get("mode")), List.of()).contains("ref")
                && map.get("ref") instanceof String ref && REF.matcher(ref).matches();
    }

    // Presence is the wizard's rule; requests filed before this section existed carry no rows.
    static void check(Map<String, Object> terms, LocalDate today, List<String> problems) {
        Object raw = terms.get("depositPayments");
        if (raw == null) {
            return;
        }
        if (!(raw instanceof List<?> rows) || !rows.stream().allMatch(Map.class::isInstance)) {
            problems.add("_state.terms.depositPayments must be a list of payments");
            return;
        }
        if (rows.isEmpty()) {
            return;
        }
        if (rows.size() > MAX_PAYMENTS) {
            problems.add("_state.terms.depositPayments must contain at most " + MAX_PAYMENTS + " rows");
            return;
        }
        long total = 0;
        boolean totalKnown = true;
        for (int i = 0; i < rows.size(); i++) {
            Long amount = row((Map<?, ?>) rows.get(i), "_state.terms.depositPayments[" + i + "]", today, problems);
            if (amount == null) {
                totalKnown = false;
            } else {
                total += amount;
            }
        }
        Long deposit = rupees(terms.get("deposit"));
        if (totalKnown && deposit != null && total != deposit) {
            problems.add("_state.terms.depositPayments must add up to _state.terms.deposit");
        }
    }

    private static Long row(Map<?, ?> row, String path, LocalDate today, List<String> problems) {
        List<String> required = REQUIRED.get(String.valueOf(row.get("mode")));
        if (required == null) {
            problems.add(path + ".mode must be one of " + new java.util.TreeSet<>(REQUIRED.keySet()));
            return null;
        }
        required.stream().filter(f -> blank(row.get(f))).forEach(f -> problems.add(path + "." + f + " is required"));
        TEXT.stream().filter(f -> !blank(row.get(f)) && row.get(f).toString().length() > MAX_TEXT)
                .forEach(f -> problems.add(path + "." + f + " must be at most " + MAX_TEXT + " characters"));
        if (required.contains("ref") && !blank(row.get("ref")) && !REF.matcher(row.get("ref").toString()).matches()) {
            problems.add(path + ".ref must be 4 to 30 letters or digits");
        }
        date(row.get("date"), path + ".date", today, problems);
        if (blank(row.get("amount"))) {
            return null;
        }
        Long amount = rupees(row.get("amount"));
        if (amount == null || amount == 0) {
            problems.add(path + ".amount must be a whole number of rupees above 0");
            return null;
        }
        return amount;
    }

    private static Long rupees(Object raw) {
        String text = blank(raw) ? "0" : raw.toString().trim();
        return AMOUNT.matcher(text).matches() ? Long.valueOf(text) : null;
    }

    private static void date(Object raw, String path, LocalDate today, List<String> problems) {
        if (blank(raw)) {
            return;
        }
        try {
            if (LocalDate.parse(raw.toString()).isAfter(today)) {
                problems.add(path + " must not be after today");
            }
        } catch (DateTimeParseException malformed) {
            problems.add(path + " must be an ISO date yyyy-MM-dd");
        }
    }

    private static boolean blank(Object value) {
        return value == null || value.toString().isBlank();
    }
}
