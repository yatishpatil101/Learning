package com.draazy.api.services.request;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

final class PropertyIgrRules {

    private static final int MAX_AREA = 100_000;
    private static final Set<String> AREA_UNITS = Set.of("sqft", "sqm");
    private static final Set<String> TALUKAS = Set.of("Pune City", "Haveli", "Mulshi", "Maval", "Khed",
            "Shirur", "Daund", "Indapur", "Baramati", "Purandar", "Bhor", "Velhe / Rajgad", "Junnar",
            "Ambegaon", "Pimpri-Chinchwad / Pimpri");
    private static final Set<String> ATTRIBUTE_KINDS = Set.of("CTS No.", "Survey No.", "Gat No.", "Plot No.",
            "Khata No.", "Milkat (Property) No.", "Hissa No.");
    private static final Pattern NUMBER = Pattern.compile("^[0-9]+(?:\\.[0-9]+)?$");

    private PropertyIgrRules() {
    }

    static void check(Map<String, Object> prop, Map<String, Object> terms, List<String> problems) {
        if (prop.containsKey("taluka")) {
            required(prop.get("taluka"), "_state.prop.taluka", problems);
            oneOf(prop.get("taluka"), "_state.prop.taluka", TALUKAS, problems);
        }
        if (prop.containsKey("villageCity")) {
            required(prop.get("villageCity"), "_state.prop.villageCity", problems);
            max(prop.get("villageCity"), "_state.prop.villageCity", 80, problems);
        }
        max(prop.get("roadName"), "_state.prop.roadName", 120, problems);
        max(prop.get("policeStation"), "_state.prop.policeStation", 80, problems);
        attributes(prop.get("propertyAttributes"), problems);
        optionalArea(prop.get("galleryArea"), "_state.prop.galleryArea", problems);
        unit(prop.get("galleryAreaUnit"), "_state.prop.galleryAreaUnit", problems);
        optionalArea(terms.get("parkingArea"), "_state.terms.parkingArea", problems);
        unit(terms.get("parkingAreaUnit"), "_state.terms.parkingAreaUnit", problems);
        if (isStated(terms.get("parkingArea")) && "none".equals(String.valueOf(terms.get("parking")))) {
            problems.add("_state.terms.parkingArea requires parking to be included");
        }
    }

    private static void attributes(Object raw, List<String> problems) {
        if (raw == null) {
            return;
        }
        if (!(raw instanceof List<?> rows) || !rows.stream().allMatch(Map.class::isInstance)) {
            problems.add("_state.prop.propertyAttributes must be a list of attributes");
            return;
        }
        if (rows.size() > 8) {
            problems.add("_state.prop.propertyAttributes must contain at most 8 rows");
            return;
        }
        for (int i = 0; i < rows.size(); i++) {
            Map<?, ?> row = (Map<?, ?>) rows.get(i);
            String path = "_state.prop.propertyAttributes[" + i + "]";
            if (!isStated(row.get("kind")) && !isStated(row.get("number"))) {
                continue;
            }
            required(row.get("kind"), path + ".kind", problems);
            oneOf(row.get("kind"), path + ".kind", ATTRIBUTE_KINDS, problems);
            required(row.get("number"), path + ".number", problems);
            max(row.get("number"), path + ".number", 80, problems);
        }
    }

    private static void optionalArea(Object raw, String path, List<String> problems) {
        if (!isStated(raw)) {
            return;
        }
        String text = raw.toString().trim();
        if (!NUMBER.matcher(text).matches()) {
            problems.add(path + " must be a number from 1 to " + MAX_AREA);
            return;
        }
        BigDecimal value = new BigDecimal(text);
        if (value.compareTo(BigDecimal.ONE) < 0 || value.compareTo(BigDecimal.valueOf(MAX_AREA)) > 0
                || value.scale() > 2) {
            problems.add(path + " must be a number from 1 to " + MAX_AREA + " with at most two decimals");
        }
    }

    private static void unit(Object raw, String path, List<String> problems) {
        if (isStated(raw) && !AREA_UNITS.contains(raw.toString())) {
            problems.add(path + " must be one of " + String.join(", ", new java.util.TreeSet<>(AREA_UNITS)));
        }
    }

    private static void oneOf(Object raw, String path, Set<String> allowed, List<String> problems) {
        if (isStated(raw) && !allowed.contains(raw.toString())) {
            problems.add(path + " must be one of " + String.join(", ", new java.util.TreeSet<>(allowed)));
        }
    }

    private static void required(Object value, String path, List<String> problems) {
        if (!isStated(value)) {
            problems.add(path + " is required");
        }
    }

    private static void max(Object raw, String path, int max, List<String> problems) {
        if (isStated(raw) && raw.toString().trim().length() > max) {
            problems.add(path + " must be at most " + max + " characters");
        }
    }

    private static boolean isStated(Object value) {
        return value != null && !value.toString().isBlank();
    }
}
