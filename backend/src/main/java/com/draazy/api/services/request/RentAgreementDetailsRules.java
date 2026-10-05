package com.draazy.api.services.request;

import com.draazy.api.catalog.fee.LeaveAndLicenceCharges;
import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.error.ValidationException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

// Server copy of wizard term rules; protects checkout when clients skip steps.
final class RentAgreementDetailsRules {

    static final int START_DATE_PAST_DAYS = 30;
    static final int START_DATE_FUTURE_DAYS = 180;

    static final int DUE_DAY_MAX = 28;

    static final Set<String> CAPACITIES = Set.of("owner", "co-owner", "poa");

    static final int MAX_CO_OWNERS = 3;
    static final int MAX_TENANTS = 6;
    static final int MAX_OCCUPANTS = 20;
    static final int MAX_AREA = 100_000;
    static final int MAX_FLOOR = 200;

    private static final Set<String> AREA_BASES = Set.of("carpet", "built-up");
    private static final Set<String> AREA_UNITS = Set.of("sqft", "sqm");
    private static final Set<String> PAYERS = Set.of("Tenant", "Owner");
    private static final Set<String> COST_BEARERS = Set.of("Tenant", "Owner", "Split");
    private static final Set<String> PARKING = Set.of("none", "two-wheeler", "car", "both");
    private static final Set<String> LANGUAGES = Set.of("English", "Marathi");
    private static final Set<String> VISIT_PLACES = Set.of("property", "licensor", "licensee");
    private static final Set<String> VISIT_SLOTS = Set.of("any", "morning", "afternoon", "evening");
    private static final Set<String> PARTY_TYPES = Set.of("individual", "entity");
    private static final Set<String> RESIDENCIES = Set.of("resident", "nri", "foreign");
    static final int VISIT_DATE_FUTURE_DAYS = 90;

    private static final Pattern INTEGER = Pattern.compile("^[0-9]+$");
    private static final Pattern NUMBER = Pattern.compile("^[0-9]+(?:\\.[0-9]+)?$");
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$");
    private static final Pattern PASSPORT = Pattern.compile("^[A-Za-z0-9]{6,20}$");

    private static final Pattern MH_PINCODE = Pattern.compile("^(?!403)4[0-4][0-9]{4}$");
    private static final Set<String> PRICED_TERMS = Set.of("rent", "deposit", "nrDeposit", "months");

    private RentAgreementDetailsRules() {
    }

    static void check(Map<String, Object> details) {
        check(details, LocalDate.now(PlatformTime.IST), true);
    }

    static void check(Map<String, Object> details, LocalDate today) {
        check(details, today, true);
    }

    static void checkMerged(Map<String, Object> details) {
        check(details, LocalDate.now(PlatformTime.IST), false);
    }

    static void checkPricedTerms(Map<String, Object> details) {
        Map<String, Object> terms = ServiceRequestPricing.childObject(
                ServiceRequestPricing.childObject(details, "_state"), "terms");
        List<String> problems = new ArrayList<>();
        termAndRise(terms, problems);
        pricedTerms(details, terms, problems);
        if (!problems.isEmpty()) {
            throw new ValidationException("Amended terms: " + String.join("; ", problems));
        }
    }

    static void check(Map<String, Object> details, LocalDate today, boolean requireWitnessNames) {
        if (details == null) {
            return;
        }
        Map<String, Object> state = ServiceRequestPricing.childObject(details, "_state");
        List<String> problems = new ArrayList<>();
        Map<String, Object> terms = ServiceRequestPricing.childObject(state, "terms");
        terms(terms, today, problems);
        visit(terms, today, requireWitnessNames, problems);
        pricedTerms(details, terms, problems);
        Map<String, Object> prop = ServiceRequestPricing.childObject(state, "prop");
        Object pincode = prop.get("pincode");
        if (isStated(pincode) && !MH_PINCODE.matcher(pincode.toString().trim()).matches()) {
            problems.add("_state.prop.pincode must be a Maharashtra pincode");
        }
        decimal(prop.get("area"), "_state.prop.area", BigDecimal.ONE, BigDecimal.valueOf(MAX_AREA), problems);
        oneOf(prop.get("areaBasis"), "_state.prop.areaBasis", AREA_BASES, problems);
        oneOf(prop.get("areaUnit"), "_state.prop.areaUnit", AREA_UNITS, problems);
        whole(prop.get("floor"), "_state.prop.floor", 0, MAX_FLOOR, problems);
        PropertyIgrRules.check(prop, terms, problems);
        List<Map<?, ?>> coOwners = rows(state.get("coOwners"));
        List<Map<?, ?>> tenants = rows(state.get("tenants"));
        if (coOwners.size() > MAX_CO_OWNERS) {
            problems.add("_state.coOwners must contain at most " + MAX_CO_OWNERS + " rows");
        }
        if (tenants.size() > MAX_TENANTS) {
            problems.add("_state.tenants must contain at most " + MAX_TENANTS + " rows");
        }
        emails(state, coOwners, tenants, problems);
        adults(state, coOwners, tenants, problems);
        PartyIdentityRules.check(state, coOwners, tenants, today, problems);
        TenantPoliceRecordRules.check(tenants, problems);
        partyTypesAndResidency(state, coOwners, tenants, problems);
        witnesses(state, requireWitnessNames, problems);
        capacities(state, coOwners, today, problems);
        distinctMobiles(state, coOwners, tenants, problems);
        if (!problems.isEmpty()) {
            throw new ValidationException("Rent agreement details: " + String.join("; ", problems));
        }
    }

    private static void terms(Map<String, Object> terms, LocalDate today, List<String> problems) {
        termAndRise(terms, problems);
        whole(terms.get("dueDay"), "_state.terms.dueDay", 1, DUE_DAY_MAX, problems);
        whole(terms.get("incrementEvery"), "_state.terms.incrementEvery", 11, 12, problems);
        whole(terms.get("occupants"), "_state.terms.occupants", 1, MAX_OCCUPANTS, problems);
        oneOf(terms.get("utilitiesBy"), "_state.terms.utilitiesBy", PAYERS, problems);
        oneOf(terms.get("taxBy"), "_state.terms.taxBy", PAYERS, problems);
        oneOf(terms.get("costBy"), "_state.terms.costBy", COST_BEARERS, problems);
        oneOf(terms.get("parking"), "_state.terms.parking", PARKING, problems);
        DepositPaymentRules.check(terms, today, problems);
        Object start = terms.get("startDate");
        if (!isStated(start)) {
            return;
        }
        try {
            LocalDate date = LocalDate.parse(start.toString());
            if (date.isBefore(today.minusDays(START_DATE_PAST_DAYS))
                    || date.isAfter(today.plusDays(START_DATE_FUTURE_DAYS))) {
                problems.add("_state.terms.startDate must be within 30 days before and 180 days after today");
            }
        } catch (DateTimeParseException malformed) {
            problems.add("_state.terms.startDate must be an ISO date yyyy-MM-dd");
        }
    }

    private static void visit(Map<String, Object> terms, LocalDate today, boolean filing,
            List<String> problems) {
        oneOf(terms.get("language"), "_state.terms.language", LANGUAGES, problems);
        oneOf(terms.get("visitAt"), "_state.terms.visitAt", VISIT_PLACES, problems);
        oneOf(terms.get("visitSlot"), "_state.terms.visitSlot", VISIT_SLOTS, problems);
        Object raw = terms.get("visitDate");
        if (!isStated(raw)) {
            return;
        }
        try {
            LocalDate date = LocalDate.parse(raw.toString());
            if (date.isAfter(today.plusDays(VISIT_DATE_FUTURE_DAYS)) || (filing && !date.isAfter(today))) {
                problems.add("_state.terms.visitDate must be from tomorrow to " + VISIT_DATE_FUTURE_DAYS
                        + " days ahead");
            }
        } catch (DateTimeParseException malformed) {
            problems.add("_state.terms.visitDate must be an ISO date yyyy-MM-dd");
        }
    }

    private static void termAndRise(Map<String, Object> terms, List<String> problems) {
        Long months = whole(terms.get("months"), "_state.terms.months", 1,
                LeaveAndLicenceCharges.MAX_MONTHS, problems);
        long cap = months == null ? LeaveAndLicenceCharges.MAX_MONTHS : months;
        whole(terms.get("lockin"), "_state.terms.lockin", 0, cap, problems);
        whole(terms.get("notice"), "_state.terms.notice", 0, cap, problems);
        decimal(terms.get("increment"), "_state.terms.increment", BigDecimal.ZERO,
                BigDecimal.valueOf(100), problems);
    }

    private static void pricedTerms(Map<String, Object> details, Map<String, Object> stateTerms,
            List<String> problems) {
        PRICED_TERMS.forEach(key -> {
            Object flat = details.get(key);
            Object snapshot = stateTerms.get(key);
            Long flatValue = wholeNonNegative(flat);
            Long snapshotValue = wholeNonNegative(snapshot);
            if ((isStated(flat) && flatValue == null)
                    || (!"months".equals(key) && isStated(snapshot) && snapshotValue == null)) {
                problems.add("details." + key + " must be a whole number, digits only");
            } else if (flatValue != null && snapshotValue != null && !flatValue.equals(snapshotValue)) {
                problems.add("details." + key + " differs from _state.terms." + key);
            }
        });
    }

    private static Long wholeNonNegative(Object raw) {
        if (!isStated(raw)) {
            return null;
        }
        String text = raw.toString().trim();
        if (!INTEGER.matcher(text).matches()) {
            return null;
        }
        try {
            return Long.parseLong(text);
        } catch (NumberFormatException overflow) {
            return null;
        }
    }

    private static void oneOf(Object raw, String path, Set<String> allowed, List<String> problems) {
        if (isStated(raw) && !allowed.contains(raw.toString())) {
            problems.add(path + " must be one of " + String.join(", ", new java.util.TreeSet<>(allowed)));
        }
    }

    private static Long whole(Object raw, String path, long min, long max, List<String> problems) {
        if (!isStated(raw)) {
            return null;
        }
        String text = raw.toString().trim();
        if (!INTEGER.matcher(text).matches()) {
            problems.add(path + " must be an integer from " + min + " to " + max);
            return null;
        }
        try {
            long value = Long.parseLong(text);
            if (value < min || value > max) {
                problems.add(path + " must be an integer from " + min + " to " + max);
                return null;
            }
            return value;
        } catch (NumberFormatException tooLarge) {
            problems.add(path + " must be an integer from " + min + " to " + max);
            return null;
        }
    }

    private static void decimal(Object raw, String path, BigDecimal min, BigDecimal max,
            List<String> problems) {
        if (!isStated(raw)) {
            return;
        }
        String text = raw.toString().trim();
        if (!NUMBER.matcher(text).matches()) {
            problems.add(path + " must be a number from " + min + " to " + max);
            return;
        }
        BigDecimal value = new BigDecimal(text);
        if (value.compareTo(min) < 0 || value.compareTo(max) > 0 || value.scale() > 2) {
            problems.add(path + " must be a number from " + min + " to " + max
                    + " with at most two decimals");
        }
    }

    private static void witnesses(Map<String, Object> state, boolean requireWitnessNames,
            List<String> problems) {
        Object witRaw = state.get("wit");
        Map<String, Object> wit = ServiceRequestPricing.childObject(state, "wit");
        if (witRaw instanceof Map<?, ?> && requireWitnessNames) {
            required(wit.get("w1Name"), "_state.wit.w1Name", problems);
            required(wit.get("w2Name"), "_state.wit.w2Name", problems);
        }
        whole(wit.get("w1Age"), "_state.wit.w1Age", 18, 150, problems);
        whole(wit.get("w2Age"), "_state.wit.w2Age", 18, 150, problems);
    }

    private static void adults(Map<String, Object> state, List<Map<?, ?>> coOwners,
            List<Map<?, ?>> tenants, List<String> problems) {
        whole(ServiceRequestPricing.childObject(state, "owner").get("oAge"), "_state.owner.oAge", 18, 150,
                problems);
        for (int i = 0; i < coOwners.size(); i++) {
            whole(coOwners.get(i).get("age"), "_state.coOwners[" + i + "].age", 18, 150, problems);
        }
        for (int i = 0; i < tenants.size(); i++) {
            whole(tenants.get(i).get("age"), "_state.tenants[" + i + "].age", 18, 150, problems);
        }
    }

    private static void emails(Map<String, Object> state, List<Map<?, ?>> coOwners,
            List<Map<?, ?>> tenants, List<String> problems) {
        email(ServiceRequestPricing.childObject(state, "owner").get("oEmail"),
                "_state.owner.oEmail", problems);
        for (int i = 0; i < coOwners.size(); i++) {
            email(coOwners.get(i).get("email"), "_state.coOwners[" + i + "].email", problems);
        }
        for (int i = 0; i < tenants.size(); i++) {
            email(tenants.get(i).get("email"), "_state.tenants[" + i + "].email", problems);
        }
    }

    private static void partyTypesAndResidency(Map<String, Object> state, List<Map<?, ?>> coOwners,
            List<Map<?, ?>> tenants, List<String> problems) {
        partyTypeAndResidency(ServiceRequestPricing.childObject(state, "owner"), "_state.owner", problems);
        for (int i = 0; i < coOwners.size(); i++) {
            partyTypeAndResidency(coOwners.get(i), "_state.coOwners[" + i + "]", problems);
        }
        for (int i = 0; i < tenants.size(); i++) {
            partyTypeAndResidency(tenants.get(i), "_state.tenants[" + i + "]", problems);
        }
    }

    private static void partyTypeAndResidency(Map<?, ?> row, String path, List<String> problems) {
        String type = value(row.get("type"), "individual");
        if (!PARTY_TYPES.contains(type)) {
            problems.add(path + ".type must be individual or entity");
        }
        String residency = value(row.get("residency"), "resident");
        if (!RESIDENCIES.contains(residency)) {
            problems.add(path + ".residency must be resident, nri or foreign");
            return;
        }
        if ("resident".equals(residency)) {
            return;
        }
        if (!isStated(row.get("passport")) || !PASSPORT.matcher(row.get("passport").toString().trim()).matches()) {
            problems.add(path + ".passport must be 6 to 20 letters or digits");
        }
        if ("foreign".equals(residency)) {
            required(row.get("visaOci"), path + ".visaOci", problems);
        }
    }

    private static String value(Object raw, String fallback) {
        return isStated(raw) ? raw.toString().trim() : fallback;
    }

    private static void email(Object raw, String path, List<String> problems) {
        if (isStated(raw) && !EMAIL.matcher(raw.toString().trim()).matches()) {
            problems.add(path + " must be a valid email address");
        }
    }

    private static void capacities(Map<String, Object> state, List<Map<?, ?>> coOwners,
            LocalDate today, List<String> problems) {
        Map<String, Object> owner = ServiceRequestPricing.childObject(state, "owner");
        String ownerCapacity = capacity(owner.get("capacity"), "owner", "_state.owner.capacity", problems);
        if (!coOwners.isEmpty() && "owner".equals(ownerCapacity)) {
            problems.add("_state.owner.capacity must be co-owner or poa when coOwners are present");
        }
        if (coOwners.isEmpty() && "co-owner".equals(ownerCapacity)) {
            problems.add("_state.owner.capacity cannot be co-owner without coOwners");
        }
        poa(owner, "_state.owner", today, problems);
        for (int i = 0; i < coOwners.size(); i++) {
            Map<?, ?> row = coOwners.get(i);
            String path = "_state.coOwners[" + i + "]";
            String capacity = capacity(row.get("capacity"), "co-owner", path + ".capacity", problems);
            if ("owner".equals(capacity)) {
                problems.add(path + ".capacity must be co-owner or poa");
            }
            poa(row, path, today, problems);
        }
    }

    private static String capacity(Object raw, String fallback, String path, List<String> problems) {
        String value = isStated(raw) ? raw.toString().trim() : fallback;
        if (!CAPACITIES.contains(value)) {
            problems.add(path + " must be owner, co-owner or poa");
        }
        return value;
    }

    private static void poa(Map<?, ?> row, String path, LocalDate today, List<String> problems) {
        if (!"poa".equals(isStated(row.get("capacity")) ? row.get("capacity").toString().trim() : "")) {
            return;
        }
        required(row.get("poaPrincipal"), path + ".poaPrincipal", problems);
        required(row.get("poaRegNo"), path + ".poaRegNo", problems);
        required(row.get("poaSro"), path + ".poaSro", problems);
        Object rawDate = row.get("poaDate");
        required(rawDate, path + ".poaDate", problems);
        if (isStated(rawDate)) {
            try {
                if (LocalDate.parse(rawDate.toString()).isAfter(today)) {
                    problems.add(path + ".poaDate must not be after today");
                }
            } catch (DateTimeParseException malformed) {
                problems.add(path + ".poaDate must be an ISO date yyyy-MM-dd");
            }
        }
    }

    private static void required(Object value, String path, List<String> problems) {
        if (!isStated(value)) {
            problems.add(path + " is required");
        }
    }

    private static void distinctMobiles(Map<String, Object> state, List<Map<?, ?>> coOwners,
            List<Map<?, ?>> tenants, List<String> problems) {
        Set<String> seen = new HashSet<>();
        List<Object> mobiles = new ArrayList<>();
        mobiles.add(ServiceRequestPricing.childObject(state, "owner").get("oMobile"));
        coOwners.forEach(row -> mobiles.add(row.get("mobile")));
        if (!"invite".equals(String.valueOf(state.get("tenantMode")))) {
            tenants.forEach(row -> mobiles.add(row.get("mobile")));
        }
        Map<String, Object> wit = ServiceRequestPricing.childObject(state, "wit");
        mobiles.add(wit.get("w1Mobile"));
        mobiles.add(wit.get("w2Mobile"));
        for (Object raw : mobiles) {
            String mobile = normaliseMobile(raw);
            if (mobile != null && !seen.add(mobile)) {
                problems.add("two parties share a mobile number");
                return;
            }
        }
    }

    private static String normaliseMobile(Object raw) {
        if (!isStated(raw)) {
            return null;
        }
        String digits = raw.toString().replaceAll("\\D", "");
        return digits.length() < 10 ? null : digits.substring(digits.length() - 10);
    }

    private static List<Map<?, ?>> rows(Object value) {
        if (!(value instanceof List<?> items)) {
            return List.of();
        }
        return items.stream().filter(Map.class::isInstance).<Map<?, ?>>map(Map.class::cast).toList();
    }

    private static boolean isStated(Object value) {
        return value != null && !value.toString().isBlank();
    }
}
