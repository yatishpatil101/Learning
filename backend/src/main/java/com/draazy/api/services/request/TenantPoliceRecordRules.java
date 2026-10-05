package com.draazy.api.services.request;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

final class TenantPoliceRecordRules {

    private static final int MAX_ADDRESS = 200;
    private static final int MAX_NAME = 80;
    private static final int MAX_TEXT = 80;
    private static final int MAX_OCCUPANTS = 20;
    private static final Set<String> ADDRESS_PROOFS = Set.of("driving-license", "election-card", "passport",
            "uid");
    private static final Set<String> OCCUPANT_TYPES = Set.of("family", "co-tenant");
    private static final Set<String> RELATIONS = Set.of("father", "mother", "spouse", "son", "daughter",
            "brother", "sister", "friend", "other");
    private static final Pattern PINCODE = Pattern.compile("^\\d{6}$");
    private static final Pattern INTEGER = Pattern.compile("^\\d+$");
    private static final Pattern MOBILE = Pattern.compile("^[6-9]\\d{9}$");
    private static final Pattern WORK_OPTIONAL = Pattern.compile(
            "(?i).*\\b(student|home\\s*maker|homemaker|housewife|retired)\\b.*");

    private TenantPoliceRecordRules() {
    }

    static void check(List<Map<?, ?>> tenants, List<String> problems) {
        for (int i = 0; i < tenants.size(); i++) {
            Object raw = tenants.get(i).get("police");
            if (raw == null) {
                continue;
            }
            String path = "_state.tenants[" + i + "].police";
            if (!(raw instanceof Map<?, ?> police)) {
                problems.add(path + " must be an object");
                continue;
            }
            oneOf(police.get("addressProofType"), path + ".addressProofType", ADDRESS_PROOFS, problems);
            address(row(police.get("permanent")), path + ".permanent",
                    !flag(police.get("permanentSameAsCurrent"), true), problems);
            address(row(police.get("previous")), path + ".previous",
                    !flag(police.get("previousSameAsPermanent"), true), problems);
            if (!flag(police.get("previousSameAsPermanent"), true)) {
                oneOf(police.get("previousAddressProofType"), path + ".previousAddressProofType",
                        ADDRESS_PROOFS, problems);
            }
            if (requiresWorkplaceSection(tenants.get(i))) {
                required(police.get("workplaceAddress"), path + ".workplaceAddress", problems);
                required(police.get("workIdProofType"), path + ".workIdProofType", problems);
            }
            length(police.get("workplaceAddress"), path + ".workplaceAddress", MAX_ADDRESS, problems);
            length(police.get("workIdProofType"), path + ".workIdProofType", MAX_TEXT, problems);
            occupants(police.get("occupants"), path + ".occupants", problems);
        }
    }

    private static void address(Map<?, ?> row, String path, boolean required, List<String> problems) {
        if (required) {
            required(row.get("address"), path + ".address", problems);
            required(row.get("pincode"), path + ".pincode", problems);
            required(row.get("village"), path + ".village", problems);
            required(row.get("policeStation"), path + ".policeStation", problems);
        }
        length(row.get("address"), path + ".address", MAX_ADDRESS, problems);
        length(row.get("village"), path + ".village", MAX_TEXT, problems);
        length(row.get("policeStation"), path + ".policeStation", MAX_TEXT, problems);
        if (isStated(row.get("pincode")) && !PINCODE.matcher(text(row.get("pincode"))).matches()) {
            problems.add(path + ".pincode must be a 6-digit pincode");
        }
    }

    private static void occupants(Object raw, String path, List<String> problems) {
        if (raw == null) {
            return;
        }
        if (!(raw instanceof List<?> rows) || !rows.stream().allMatch(Map.class::isInstance)) {
            problems.add(path + " must be a list");
            return;
        }
        if (rows.size() > MAX_OCCUPANTS) {
            problems.add(path + " must contain at most " + MAX_OCCUPANTS + " rows");
            return;
        }
        for (int i = 0; i < rows.size(); i++) {
            Map<?, ?> row = (Map<?, ?>) rows.get(i);
            String rowPath = path + "[" + i + "]";
            oneOf(row.get("type"), rowPath + ".type", OCCUPANT_TYPES, problems);
            required(row.get("fullName"), rowPath + ".fullName", problems);
            oneOf(row.get("relation"), rowPath + ".relation", RELATIONS, problems);
            required(row.get("age"), rowPath + ".age", problems);
            required(row.get("mobile"), rowPath + ".mobile", problems);
            length(row.get("fullName"), rowPath + ".fullName", MAX_NAME, problems);
            length(row.get("relation"), rowPath + ".relation", MAX_TEXT, problems);
            whole(row.get("age"), rowPath + ".age", 0, 120, problems);
            if (isStated(row.get("mobile"))
                    && !MOBILE.matcher(row.get("mobile").toString().replaceAll("\\D", "")).matches()) {
                problems.add(rowPath + ".mobile must be a 10-digit Indian mobile");
            }
        }
    }

    private static Map<?, ?> row(Object value) {
        return value instanceof Map<?, ?> map ? map : Map.of();
    }

    static boolean requiresWorkplaceSection(Map<?, ?> tenant) {
        return !WORK_OPTIONAL.matcher(text(tenant.get("occupation"))).matches();
    }

    private static void oneOf(Object raw, String path, Set<String> allowed, List<String> problems) {
        if (!isStated(raw) || !allowed.contains(text(raw))) {
            problems.add(path + " must be one of " + String.join(", ", new java.util.TreeSet<>(allowed)));
        }
    }

    private static void whole(Object raw, String path, long min, long max, List<String> problems) {
        if (!isStated(raw)) {
            return;
        }
        String value = text(raw);
        if (!INTEGER.matcher(value).matches()) {
            problems.add(path + " must be an integer from " + min + " to " + max);
            return;
        }
        long n;
        try {
            n = Long.parseLong(value);
        } catch (NumberFormatException overflow) {
            problems.add(path + " must be an integer from " + min + " to " + max);
            return;
        }
        if (n < min || n > max) {
            problems.add(path + " must be an integer from " + min + " to " + max);
        }
    }

    private static boolean flag(Object raw, boolean fallback) {
        return raw instanceof Boolean bool ? bool : fallback;
    }

    private static void required(Object value, String path, List<String> problems) {
        if (!isStated(value)) {
            problems.add(path + " is required");
        }
    }

    private static void length(Object value, String path, int max, List<String> problems) {
        if (isStated(value) && value.toString().trim().length() > max) {
            problems.add(path + " must be at most " + max + " characters");
        }
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString().trim();
    }

    private static boolean isStated(Object value) {
        return !text(value).isBlank();
    }
}
