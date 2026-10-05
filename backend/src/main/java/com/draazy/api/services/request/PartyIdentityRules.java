package com.draazy.api.services.request;

import java.time.LocalDate;
import java.time.Period;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;

final class PartyIdentityRules {

    private static final int MAX_TEXT = 80;
    private static final int MIN_AGE = 18;
    private static final int MAX_AGE = 150;

    private PartyIdentityRules() {
    }

    static void check(Map<String, Object> state, List<Map<?, ?>> coOwners, List<Map<?, ?>> tenants,
            LocalDate today, List<String> problems) {
        row(ServiceRequestPricing.childObject(state, "owner"), "_state.owner", "oMother", "oDob", "oAlias",
                "oAge", today, problems);
        for (int i = 0; i < coOwners.size(); i++) {
            row(coOwners.get(i), "_state.coOwners[" + i + "]", "mother", "dob", "alias", "age", today, problems);
        }
        for (int i = 0; i < tenants.size(); i++) {
            row(tenants.get(i), "_state.tenants[" + i + "]", "mother", "dob", "alias", "age", today, problems);
        }
    }

    private static void row(Map<?, ?> row, String path, String motherKey, String dobKey, String aliasKey,
            String ageKey, LocalDate today, List<String> problems) {
        bounded(row.get(motherKey), path + "." + motherKey, problems);
        bounded(row.get(aliasKey), path + "." + aliasKey, problems);
        if (!stated(row.get(dobKey))) {
            return;
        }
        LocalDate dob = date(row.get(dobKey), path + "." + dobKey, today, problems);
        if (dob == null) {
            return;
        }
        int age = Period.between(dob, today).getYears();
        if (age < MIN_AGE || age > MAX_AGE) {
            problems.add(path + "." + dobKey + " must make the party " + MIN_AGE + " to " + MAX_AGE + " years old");
        }
        if (stated(row.get(ageKey))) {
            Long statedAge = integer(row.get(ageKey));
            if (statedAge != null && statedAge.intValue() != age) {
                problems.add(path + "." + ageKey + " must match " + path + "." + dobKey);
            }
        }
    }

    private static void bounded(Object raw, String path, List<String> problems) {
        if (stated(raw) && raw.toString().trim().length() > MAX_TEXT) {
            problems.add(path + " must be at most " + MAX_TEXT + " characters");
        }
    }

    private static LocalDate date(Object raw, String path, LocalDate today, List<String> problems) {
        try {
            LocalDate dob = LocalDate.parse(raw.toString());
            if (dob.isAfter(today)) {
                problems.add(path + " must not be after today");
                return null;
            }
            return dob;
        } catch (DateTimeParseException malformed) {
            problems.add(path + " must be an ISO date yyyy-MM-dd");
            return null;
        }
    }

    private static Long integer(Object raw) {
        try {
            return Long.valueOf(raw.toString().trim());
        } catch (NumberFormatException malformed) {
            return null;
        }
    }

    private static boolean stated(Object value) {
        return value != null && !value.toString().isBlank();
    }
}
