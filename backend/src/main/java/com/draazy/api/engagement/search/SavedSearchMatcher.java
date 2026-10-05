package com.draazy.api.engagement.search;

import com.draazy.api.catalog.property.ListingFacets;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertySearchQuery;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
class SavedSearchMatcher {

    private static final long BUY_MAX = 50_000_000L;
    private static final long RENT_MAX = 100_000L;
    private static final int MAX_LIST_VALUES = 12;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final Pattern BHK_TOKEN = Pattern.compile("\\d{1,2}(plus)?");

    private final PropertyRepository properties;
    private final EntityManager em;
    private final SavedSearchMapper mapper;

    SavedSearchMatcher(PropertyRepository properties, EntityManager em,
            SavedSearchMapper mapper) {
        this.properties = properties;
        this.em = em;
        this.mapper = mapper;
    }

    int count(SavedSearch search, Instant baseline) {
        long count = switch (search.getKind()) {
            case "listings" -> countListings(search, baseline);
            case "flatmates" -> countFlatmates(search, baseline);
            default -> 0L;
        };
        return Math.toIntExact(Math.min(count, Integer.MAX_VALUE));
    }

    private long countListings(SavedSearch search, Instant baseline) {
        Map<String, Object> filters = objectMap(mapper.jsonStringToObject(search.getFilters()));
        String deal = text(filters, "deal");
        if (deal == null) {
            return 0L;
        }
        deal = deal.toLowerCase(Locale.ROOT);

        long[] price = priceRange(deal, filters);
        PropertySearchQuery query = new PropertySearchQuery(
                deal, null, null, null,
                price[0] > 0 ? price[0] : null,
                price[1] > 0 ? price[1] : null,
                null, null,
                text(filters, "q"),
                null, null);
        ListingFacets facets = new ListingFacets(
                facetList(filters, "types"),
                commercialUses(filters),
                bhkList(filters),
                facetList(filters, "furnishing"),
                facetList(filters, "localities"),
                null,
                facetList(filters, "amenities"),
                facetList(filters, "facing"),
                facetList(filters, "landUse"),
                facetList(filters, "room"),
                facetList(filters, "tenants"),
                facetList(filters, "construction"),
                null,
                trueOrNull(filters, "pets"),
                null, null, null, null, null,
                food(filters),
                facetList(filters, "shell"),
                trueOrNull(filters, "preLeased"),
                facetList(filters, "na"),
                areaBound(filters, "minArea", 0),
                areaBound(filters, "maxArea", 1),
                intValue(filters, "minBaths"),
                null, null, null, null, null, null,
                null, null, null);
        return properties.countVisibleMatching(query, facets, baseline);
    }

    private long countFlatmates(SavedSearch search, Instant baseline) {
        Map<String, Object> criteria = objectMap(mapper.jsonStringToNullableObject(search.getCriteria()));
        if (criteria.isEmpty()) {
            criteria = objectMap(mapper.jsonStringToObject(search.getFilters()));
        }
        if (criteria.isEmpty()) {
            return 0L;
        }
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("publicStatuses", List.of("live", "approved"));
        String tab = "team-up".equals(text(criteria, "tab")) ? "team-up" : "move-in";
        String matches = "move-in".equals(tab)
                ? "select count(*) from (" + roomSelect(criteria, params, baseline)
                        + " union all " + groupSelect(criteria, params, baseline, true) + ") x"
                : "select count(*) from (" + postSelect(criteria, params, baseline)
                        + " union all " + groupSelect(criteria, params, baseline, false) + ") x";
        Query query = em.createNativeQuery(matches);
        params.forEach(query::setParameter);
        return ((Number) query.getSingleResult()).longValue();
    }

    private static String roomSelect(Map<String, Object> criteria, Map<String, Object> params,
            Instant baseline) {
        StringBuilder sql = new StringBuilder("""
                select r.id
                from flatmate_rooms r
                where r.archived = false and r.mod_status in (:publicStatuses)
                """);
        commonFlatmateFilters(sql, "r", criteria, params, baseline);
        Long min = longValue(criteria, "budgetMin");
        Long max = longValue(criteria, "budget");
        if (min != null) {
            sql.append(" and r.budget >= :minBudget");
            params.put("minBudget", min);
        }
        if (max != null) {
            sql.append(" and r.budget <= :maxBudget");
            params.put("maxBudget", max);
        }
        String gender = text(criteria, "gender");
        if (gender != null) {
            sql.append(" and (r.gender = :gender or r.gender = 'any')");
            params.put("gender", gender);
        }
        if (Boolean.TRUE.equals(booleanValue(criteria, "attachedBath"))) {
            sql.append(" and r.attached_bath = 'attached'");
        }
        Integer days = moveInDays(text(criteria, "moveIn"));
        if (days != null) {
            sql.append(" and (r.available_from is null or r.available_from <= ")
                    .append("cast((now() at time zone 'Asia/Kolkata') as date) + cast(:moveInDays as integer))");
            params.put("moveInDays", days);
        }
        if (Boolean.TRUE.equals(booleanValue(criteria, "verifiedOnly"))) {
            sql.append(" and (r.verification_tier = 'owner' or r.verification_tier = 'tenant')");
        }
        return sql.toString();
    }

    private static String groupSelect(Map<String, Object> criteria, Map<String, Object> params,
            Instant baseline, boolean housed) {
        StringBuilder sql = new StringBuilder("""
                select g.id
                from flatmate_groups g
                where g.archived = false and g.mod_status in (:publicStatuses)
                """);
        sql.append(housed ? " and g.property_id is not null" : " and g.property_id is null");
        commonFlatmateFilters(sql, "g", criteria, params, baseline);
        Long min = longValue(criteria, "budgetMin");
        Long max = longValue(criteria, "budget");
        if (min != null) {
            sql.append(" and g.per_head >= :minBudget");
            params.put("minBudget", min);
        }
        if (max != null) {

            sql.append(" and coalesce(round(cast(g.rent_min as numeric) / g.seats_total), g.per_head)"
                    + " <= :maxBudget");
            params.put("maxBudget", max);
        }
        String policy = policy(text(criteria, "gender"));
        if (policy != null) {
            sql.append(" and (g.policy = :policy or g.policy = 'any')");
            params.put("policy", policy);
        }
        Integer sharing = intValue(criteria, "sharing");
        if (sharing != null) {
            sql.append(" and g.seats_total = :sharing");
            params.put("sharing", sharing);
        }
        Integer days = moveInDays(text(criteria, "moveIn"));
        if (days != null) {
            sql.append(" and (g.move_in_by is null or g.move_in_by <= ")
                    .append("cast((now() at time zone 'Asia/Kolkata') as date) + cast(:moveInDays as integer))");
            params.put("moveInDays", days);
        }
        return sql.toString();
    }

    private static String postSelect(Map<String, Object> criteria, Map<String, Object> params,
            Instant baseline) {
        StringBuilder sql = new StringBuilder("""
                select p.id
                from flatmate_seeker_posts p
                where p.archived = false and p.mod_status in (:publicStatuses)
                """);
        commonFlatmateFilters(sql, "p", criteria, params, baseline);
        Long min = longValue(criteria, "budgetMin");
        Long max = longValue(criteria, "budget");
        if (min != null) {
            sql.append(" and p.budget >= :minBudget");
            params.put("minBudget", min);
        }
        if (max != null) {
            sql.append(" and p.budget <= :maxBudget");
            params.put("maxBudget", max);
        }
        String gender = text(criteria, "gender");
        if (gender != null) {
            sql.append(" and (p.gender = :gender or p.gender = 'any')");
            params.put("gender", gender);
        }
        Integer days = moveInDays(text(criteria, "moveIn"));
        if (days != null) {
            sql.append(" and (p.move_in_at is null or p.move_in_at <= ")
                    .append("cast((now() at time zone 'Asia/Kolkata') as date) + cast(:moveInDays as integer))");
            params.put("moveInDays", days);
        }
        if (Boolean.TRUE.equals(booleanValue(criteria, "verifiedOnly"))) {
            sql.append(" and p.verified");
        }
        return sql.toString();
    }

    private static void commonFlatmateFilters(StringBuilder sql, String alias,
            Map<String, Object> criteria, Map<String, Object> params, Instant baseline) {
        if (baseline != null) {
            sql.append(" and ").append(alias).append(".created_at > :baseline");
            params.put("baseline", baseline);
        }
        String locality = text(criteria, "locality");
        if (locality != null) {
            if ("p".equals(alias)) {
                sql.append(" and p.localities @> to_jsonb(cast(:locality as text))");
            } else if ("g".equals(alias)) {
                sql.append(" and exists (select 1 from jsonb_array_elements_text(g.localities)"
                        + " as l(v) where lower(l.v) = lower(:locality))");
            } else {
                sql.append(" and lower(").append(alias).append(".locality) = lower(:locality)");
            }
            params.put("locality", locality);
        }
        List<String> habits = textList(criteria, "habits");
        for (int i = 0; i < habits.size(); i++) {
            String name = "habit" + i;
            sql.append(" and ").append(alias).append(".tags @> to_jsonb(cast(:")
                    .append(name).append(" as text))");
            params.put(name, habits.get(i));
        }
    }

    private static String policy(String gender) {
        return switch (gender == null ? "" : gender) {
            case "female" -> "women";
            case "male" -> "men";
            default -> null;
        };
    }

    private static long[] priceRange(String deal, Map<String, Object> filters) {
        List<Object> range = rawList(filters, "buy".equals(deal) ? "budget" : "rent");
        if (range.size() < 2) {
            return new long[] {0L, 0L};
        }
        long min = Math.max(0L, longFrom(range.get(0), 0L));
        long max = Math.max(0L, longFrom(range.get(1), 0L));
        long openMax = "buy".equals(deal) ? BUY_MAX : RENT_MAX;
        return new long[] {min, max > 0 && max < openMax ? max : 0L};
    }

    private static Map<String, Object> objectMap(Object parsed) {
        if (!(parsed instanceof Map<?, ?> map)) {
            return Map.of();
        }
        Map<String, Object> out = new LinkedHashMap<>();
        map.forEach((key, value) -> out.put(String.valueOf(key), value));
        return out;
    }

    private static String text(Map<String, Object> map, String key) {
        Object raw = map.get(key);
        if (raw == null) {
            return null;
        }
        String value = String.valueOf(raw).strip();
        return value.isEmpty() ? null : value;
    }

    private static List<String> textList(Map<String, Object> map, String key) {
        return rawList(map, key).stream()
                .map(String::valueOf)
                .map(String::strip)
                .filter(v -> !v.isEmpty())
                .limit(MAX_LIST_VALUES)
                .toList();
    }

    private static List<String> facetList(Map<String, Object> map, String key) {
        Object raw = map.get(key);
        List<?> values = raw instanceof String text ? csv(text) : rawList(map, key);
        return values.stream()
                .map(String::valueOf)
                .map(String::strip)
                .filter(v -> !v.isEmpty())
                .toList();
    }

    private static List<String> commercialUses(Map<String, Object> map) {
        List<String> values = new ArrayList<>(facetList(map, "commercialUses"));
        values.addAll(facetList(map, "commercialTypes"));
        return values.stream().distinct().toList();
    }

    private static List<String> bhkList(Map<String, Object> map) {
        List<String> tokens = new ArrayList<>(textList(map, "bhk"));
        tokens.addAll(textList(map, "bhks"));
        return tokens.stream()
                .map(v -> v.toLowerCase(Locale.ROOT))
                .filter(v -> BHK_TOKEN.matcher(v).matches())
                .distinct()
                .limit(MAX_LIST_VALUES)
                .toList();
    }

    private static List<String> csv(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        return Pattern.compile(",").splitAsStream(text)
                .map(String::strip)
                .filter(v -> !v.isEmpty())
                .toList();
    }

    private static List<Object> rawList(Map<String, Object> map, String key) {
        return map.get(key) instanceof List<?> list ? list.stream().filter(v -> v != null)
                .map(v -> (Object) v).toList()
                : List.of();
    }

    private static Boolean trueOrNull(Map<String, Object> map, String key) {
        return Boolean.TRUE.equals(booleanValue(map, key)) ? true : null;
    }

    private static String food(Map<String, Object> map) {
        if (Boolean.TRUE.equals(booleanValue(map, "food"))) {
            return "nonveg";
        }
        String food = text(map, "food");
        return food != null && Set.of("veg", "jain", "nonveg").contains(food) ? food : null;
    }

    private static Boolean booleanValue(Map<String, Object> map, String key) {
        Object raw = map.get(key);
        if (raw instanceof Boolean b) {
            return b;
        }
        if (raw instanceof String s) {
            return Boolean.parseBoolean(s);
        }
        return false;
    }

    private static Long longValue(Map<String, Object> map, String key) {
        Object raw = map.get(key);
        return raw == null ? null : parseLong(raw);
    }

    private static Integer intValue(Map<String, Object> map, String key) {
        Long value = longValue(map, key);
        return value == null || value < Integer.MIN_VALUE || value > Integer.MAX_VALUE
                ? null : value.intValue();
    }

    private static BigDecimal areaBound(Map<String, Object> map, String key, int fallbackIndex) {
        Object raw = map.get(key);
        if (raw == null) {
            List<Object> range = rawList(map, "area");
            raw = range.size() > fallbackIndex ? range.get(fallbackIndex) : null;
        }
        return decimalValue(raw);
    }

    private static BigDecimal decimalValue(Object raw) {
        if (raw == null) {
            return null;
        }
        try {
            return new BigDecimal(String.valueOf(raw));
        } catch (RuntimeException bad) {
            return null;
        }
    }

    private static long longFrom(Object value, long fallback) {
        Long parsed = parseLong(value);
        return parsed == null ? fallback : parsed;
    }

    private static Long parseLong(Object value) {
        if (value instanceof Number n) {
            return n.longValue();
        }
        try {
            return Long.parseLong(String.valueOf(value));
        } catch (RuntimeException bad) {
            return null;
        }
    }

    private static Integer moveInDays(String moveIn) {
        if (moveIn == null) {
            return null;
        }
        if ("now".equals(moveIn)) {
            return 0;
        }
        try {
            return Math.max(0, (int) ChronoUnit.DAYS.between(LocalDate.now(IST),
                    LocalDate.parse(moveIn)));
        } catch (RuntimeException bad) {
            return null;
        }
    }
}
