package com.draazy.api.engagement.flatmate;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Component;

/** The flatmate board as one searchable list — a {@code UNION ALL} narrowed, ordered, counted and
 * paged by PostgreSQL. Why the database, and the binding rules: docs/flows/consumer/flatmates.md §5. */
@Component
public class FlatmateSearchQueries {

    /** Matches {@code FlatmateMapper.shareMax} — the cap on people in any one room, anywhere. */
    private static final int ROOM_SHARE_MAX = 3;

    private static final double EARTH_RADIUS_KM = 6371.0;

    /** One degree of latitude, in km. A degree of longitude shrinks with the cosine of latitude. */
    private static final double KM_PER_DEGREE = 111.045;

    /** A text block strips common indentation, so an appended {@code "    and (...)"} contributes
     * no leading space and fuses with the token before it ({@code nulland}). */
    private static final String SEP = "\n ";

    private final EntityManager em;

    public FlatmateSearchQueries(EntityManager em) {
        this.em = em;
    }

    /** One row of the merged board: which table it came from, and its key. */
    public record Ref(String kind, UUID id) {
    }

    /** @param verifiedTotal counted over every matching row, not just this page */
    public record Result(List<Ref> refs, long total, long verifiedTotal) {
    }

    public Result search(FlatmateSearchQuery facets, Pageable pageable) {
        Map<String, Object> params = new HashMap<>();
        String matches = matchesCte(facets, params);
        /* Snapshot before ordering: `orderBy` binds parameters of its own that appear nowhere in
           the CTE, and setting a parameter a statement does not mention is an error. */
        Map<String, Object> cteParams = new HashMap<>(params);

        String sql = matches + """
                select kind, id,
                       count(*) over () as total,
                       sum(case when verified then 1 else 0 end) over () as verified_total
                from matches
                """ + orderBy(facets, params) + """
                limit :limit offset :offset
                """;

        Query query = em.createNativeQuery(sql);
        params.forEach(query::setParameter);
        query.setParameter("limit", pageable.getPageSize());
        query.setParameter("offset", pageable.getOffset());

        @SuppressWarnings("unchecked")
        List<Object[]> rows = query.getResultList();
        if (rows.isEmpty()) {
            /* Both totals ride on window columns of the RETURNED rows, so an offset past the end
               carries none. Zeros would unmount the pager on a search with hundreds of results. */
            return countOnly(matches, cteParams);
        }
        List<Ref> refs = rows.stream()
                .map(row -> new Ref((String) row[0], (UUID) row[1]))
                .toList();
        return new Result(refs, ((Number) rows.getFirst()[2]).longValue(),
                ((Number) rows.getFirst()[3]).longValue());
    }

    /** The two totals for a match set whose requested page held no rows. */
    private Result countOnly(String matches, Map<String, Object> params) {
        Query count = em.createNativeQuery(matches + """
                select count(*), coalesce(sum(case when verified then 1 else 0 end), 0)
                from matches
                """);
        params.forEach(count::setParameter);
        Object[] totals = (Object[]) count.getSingleResult();
        return new Result(List.of(), ((Number) totals[0]).longValue(),
                ((Number) totals[1]).longValue());
    }

    /** Every branch ends in {@code id desc}: without a total order the boundary row of a page is
     * shown twice or skipped. Only literals chosen here are concatenated. */
    private static String orderBy(FlatmateSearchQuery f, Map<String, Object> params) {
        // A null price sorts last in both directions: "we do not know" is neither free nor dearest.
        return switch (f.sort()) {
            case FlatmateSearchQuery.SORT_NEWEST -> "order by created_at desc, id desc\n";
            case FlatmateSearchQuery.SORT_BUDGET_LOW ->
                    "order by price asc nulls last, created_at desc, id desc\n";
            case FlatmateSearchQuery.SORT_BUDGET_HIGH ->
                    "order by price desc nulls last, created_at desc, id desc\n";
            case FlatmateSearchQuery.SORT_MATCH -> matchOrder(f, params);
            // The default, and the one the board opens on: trust first, then recency inside it.
            default -> "order by verified desc, created_at desc, id desc\n";
        };
    }

    /** Kept term for term with the browser's {@code matchScore}. Terms and why:
     * docs/flows/consumer/flatmates.md §5. */
    private static String matchOrder(FlatmateSearchQuery f, Map<String, Object> params) {
        if (!f.scoresAgainstMe()) {
            return "order by created_at desc, id desc\n";
        }
        StringBuilder score = new StringBuilder("greatest(0, 2 - "
                + "extract(epoch from (now() - created_at)) / 86400.0)");

        List<String> mine = f.meLocalities();
        if (!mine.isEmpty()) {
            score.append(" + case when ");
            for (int i = 0; i < mine.size(); i++) {
                String name = "meLoc" + i;
                score.append(i == 0 ? "" : " or ")
                        .append("locs @> to_jsonb(cast(:").append(name).append(" as text))");
                params.put(name, mine.get(i));
            }
            score.append(" then 3 else 0 end");
        }
        if (f.meBudget() != null) {
            score.append(SEP).append("""
                    + case when price is null then 0
                           when price * 0.88 <= :meBudget * 1.12
                                and :meBudget * 0.88 <= price * 1.12 then 2
                           when price * 0.72 <= :meBudget * 1.28
                                and :meBudget * 0.72 <= price * 1.28 then 1
                           else 0 end""");
            params.put("meBudget", f.meBudget());
        }
        if (f.meGender() != null) {
            score.append(" + case when gender = :meGender or gender = 'any' then 1 else 0 end");
            params.put("meGender", f.meGender());
        }
        return "order by (" + score + ") desc, created_at desc, id desc\n";
    }

    private static String matchesCte(FlatmateSearchQuery f, Map<String, Object> params) {
        if (f.movingIn()) {
            return roomLedgerCte() + ", matches as (\n"
                    + roomSelect(f, params) + "\nunion all\n" + groupSelect(f, params, true)
                    + "\n)\n";
        }
        return "with matches as (\n"
                + postSelect(f, params) + "\nunion all\n" + groupSelect(f, params, false)
                + "\n)\n";
    }

    /** Computed over every unarchived room BEFORE any facet applies — otherwise a budget filter
     * would move the very price it compares against. */
    private static String roomLedgerCte() {
        return """
                with room_ledger as (
                    select r.id as id,
                           case when r.property_id is null then r.occupants
                                else sum(r.occupants) over (partition by r.property_id) end
                                as committed
                    from flatmate_rooms r
                    where r.archived = false
                )""";
    }

    /** Closes the surrounding parenthesis. IST, not the session's timezone: {@code move_in_at} is
     * written in IST and would filter a day out. */
    private static String moveInHorizon() {
        return "(cast((now() at time zone 'Asia/Kolkata') as date)"
                + " + cast(:moveInDays as integer)))";
    }

    /** No column holds this — the headroom it divides by belongs to the FLAT. Divisor floored at 1,
     * matching the browser's {@code perPersonRent}. */
    private static String perPersonPrice() {
        return """
                round(cast(r.budget as numeric) / case when r.price_basis = 'person' then 1
                      else greatest(1, least(%d - r.occupants, r.max_occupants - l.committed))
                      end)""".formatted(ROOM_SHARE_MAX);
    }

    /** From the one place that defines it — a SQL literal per branch would leave four copies of a
     * rule whose whole purpose is to be a single closed list. */
    private static String publicRows(String alias, Map<String, Object> params) {
        params.put("modPublic", FlatmateVocabulary.MOD_PUBLIC);
        return "where %1$s.archived = false and %1$s.mod_status in (:modPublic)".formatted(alias);
    }

    /** The projected column and the {@code verifiedOnly} filter both ask, and must agree. Same rule
     * as {@link FlatmateRoomRepository#feed} and {@code FlatmateMapper.hostVerified}. */
    private static String roomVerified() {
        return """
                (r.verification_tier = 'owner'
                 or (r.verification_tier = 'tenant'
                     and exists (select 1 from flatmate_reviews fr
                                 where fr.room_id = r.id and fr.status = 'approved')))""";
    }

    private static String roomSelect(FlatmateSearchQuery f, Map<String, Object> params) {
        StringBuilder sql = new StringBuilder("""
                select 'room' as kind, r.id as id, r.created_at as created_at,
                """);
        sql.append(roomVerified()).append(" as verified,\n");
        sql.append(perPersonPrice()).append(" as price,\n");
        sql.append("""
                       to_jsonb(array[r.locality]) as locs,
                       r.gender as gender
                from flatmate_rooms r
                join room_ledger l on l.id = r.id
                """);
        sql.append(publicRows("r", params)).append('\n');

        if (f.locality() != null) {
            sql.append(" and lower(r.locality) = lower(:locality)");
            params.put("locality", f.locality());
        }
        if (f.q() != null) {
            sql.append(SEP).append("""
                    and (lower(r.locality) like :q or lower(coalesce(r.society, '')) like :q
                         or lower(coalesce(r.note, '')) like :q
                         or lower(coalesce(r.flat_type, '')) like :q""")
                    .append(" or ").append(jsonbTextLike("r.tags")).append(')');
            params.put("q", like(f.q()));
        }
        if (f.minBudget() != null) {
            sql.append(" and ").append(perPersonPrice()).append(" >= :minBudget");
            params.put("minBudget", f.minBudget());
        }
        if (f.maxBudget() != null) {
            sql.append(" and ").append(perPersonPrice()).append(" <= :maxBudget");
            params.put("maxBudget", f.maxBudget());
        }
        if (f.gender() != null) {
            sql.append(" and (r.gender = :gender or r.gender = 'any')");
            params.put("gender", f.gender());
        }
        if (f.attachedBath() != null) {
            sql.append(" and r.attached_bath = :attachedBath");
            params.put("attachedBath", f.attachedBath());
        }
        if (f.moveInDays() != null) {
            /* An undated row PASSES: null means "the host has not said", and `available_from` is
               null on most rows, so requiring it empties the board on first touch. */
            sql.append(" and (r.available_from is null or r.available_from <= ")
                    .append(moveInHorizon());
            params.put("moveInDays", f.moveInDays());
        }
        appendHabits(sql, "r", f, params);
        appendRadius(sql, "r", f, params);
        if (f.verifiedOnly()) {
            sql.append(SEP).append(" and ").append(roomVerified());
        }
        return sql.toString();
    }

    /** Three readers ask, via two independent routes; dropping either is a visible contradiction:
     * docs/flows/consumer/flatmates.md §5. */
    private static String groupVerified() {
        return """
                (g.verification_tier = 'owner'
                 or (g.verification_tier = 'tenant'
                     and exists (select 1 from flatmate_reviews fr
                                 where fr.group_id = g.id and fr.status = 'approved'))
                 or (exists (select 1 from flatmate_group_members gm where gm.group_id = g.id)
                     and not exists (select 1 from flatmate_group_members gm
                                     where gm.group_id = g.id and gm.verified = false)))""";
    }

    /** The address is a predicate rather than two tables, because the same row moves between tabs
     * as its search progresses. */
    private static String groupSelect(FlatmateSearchQuery f, Map<String, Object> params,
            boolean housed) {
        StringBuilder sql = new StringBuilder("""
                select 'group' as kind, g.id as id, g.created_at as created_at,
                """);
        sql.append(groupVerified()).append(" as verified,\n");
        sql.append("""
                       cast(g.per_head as numeric) as price,
                       to_jsonb(array[g.locality]) as locs,
                       case when g.policy = 'women' then 'female'
                            when g.policy = 'men' then 'male'
                            else g.policy end as gender
                from flatmate_groups g
                """);
        sql.append(publicRows("g", params)).append('\n');
        sql.append(housed ? " and g.property_id is not null" : " and g.property_id is null");

        if (f.locality() != null) {
            sql.append(" and lower(g.locality) = lower(:locality)");
            params.put("locality", f.locality());
        }
        if (f.q() != null) {
            /* Not the members' names, for the reason on the seeker branch: a name on a card is not
               the same permission as a name being queryable. */
            sql.append(SEP).append("""
                    and (lower(g.title) like :q or lower(g.locality) like :q
                         or lower(coalesce(g.note, '')) like :q""")
                    .append(" or ").append(jsonbTextLike("g.tags")).append(')');
            params.put("q", like(f.q()));
        }
        // `per_head` is generated (V15) so it cannot drift from the card. Comparing against `rent`
        // would filter on the whole flat's price while the screen shows one member's share.
        if (f.minBudget() != null) {
            sql.append(" and g.per_head >= :minBudget");
            params.put("minBudget", f.minBudget());
        }
        if (f.maxBudget() != null) {
            sql.append(" and g.per_head <= :maxBudget");
            params.put("maxBudget", f.maxBudget());
        }
        String policy = f.policy();
        if (policy != null) {
            sql.append(" and (g.policy = :policy or g.policy = 'any')");
            params.put("policy", policy);
        }
        if (f.sharing() != null) {
            sql.append(" and g.seats_total = :sharing");
            params.put("sharing", f.sharing());
        }
        appendHabits(sql, "g", f, params);
        appendRadius(sql, "g", f, params);
        if (f.verifiedOnly()) {
            // The same expression the row projects, so the filter and the badge cannot disagree.
            sql.append(SEP).append(" and ").append(groupVerified());
        }
        return sql.toString();
    }

    private static String postSelect(FlatmateSearchQuery f, Map<String, Object> params) {
        StringBuilder sql = new StringBuilder("""
                select 'post' as kind, p.id as id, p.created_at as created_at,
                       p.verified as verified,
                       cast(p.budget as numeric) as price,
                       p.localities as locs,
                       p.gender as gender
                from flatmate_seeker_posts p
                """);
        sql.append(publicRows("p", params)).append('\n');

        // A seeker names a shortlist rather than one locality, so this is containment against the
        // jsonb array and its GIN index.
        if (f.locality() != null) {
            sql.append(" and p.localities @> to_jsonb(cast(:locality as text))");
            params.put("locality", f.locality());
        }
        if (f.q() != null) {
            // Deliberately not `p.name`: matching it would turn a no-login endpoint into a
            // searchable directory of people looking for a room.
            sql.append(SEP).append("""
                    and (lower(coalesce(p.occupation, '')) like :q
                         or lower(coalesce(p.note, '')) like :q""")
                    .append(" or ").append(jsonbTextLike("p.localities"))
                    .append(SEP).append("         or ").append(jsonbTextLike("p.tags")).append(')');
            params.put("q", like(f.q()));
        }
        if (f.minBudget() != null) {
            sql.append(" and p.budget >= :minBudget");
            params.put("minBudget", f.minBudget());
        }
        if (f.maxBudget() != null) {
            sql.append(" and p.budget <= :maxBudget");
            params.put("maxBudget", f.maxBudget());
        }
        if (f.gender() != null) {
            sql.append(" and (p.gender = :gender or p.gender = 'any')");
            params.put("gender", f.gender());
        }
        if (f.moveInDays() != null) {
            // Undated passes, for the reason spelled out on the room branch above.
            sql.append(" and (p.move_in_at is null or p.move_in_at <= ")
                    .append(moveInHorizon());
            params.put("moveInDays", f.moveInDays());
        }
        appendHabits(sql, "p", f, params);
        appendRadius(sql, "p", f, params);
        if (f.verifiedOnly()) {
            sql.append(" and p.verified");
        }
        return sql.toString();
    }

    /** One containment test per habit. {@code @>} against a scalar is what the GIN
     * {@code jsonb_path_ops} indexes answer; {@code ?} is also JDBC's bind placeholder. */
    private static void appendHabits(StringBuilder sql, String alias, FlatmateSearchQuery f,
            Map<String, Object> params) {
        List<String> habits = f.habits();
        for (int i = 0; i < habits.size(); i++) {
            String name = "habit" + i;
            sql.append(" and ").append(alias).append(".tags @> to_jsonb(cast(:")
                    .append(name).append(" as text))");
            params.put(name, habits.get(i));
        }
    }

    /** "Within N km of this point" without PostGIS — bounding box, then the exact great-circle test,
     * with a locality-centroid fallback: docs/flows/consumer/flatmates.md §5. */
    private static void appendRadius(StringBuilder sql, String alias, FlatmateSearchQuery f,
            Map<String, Object> params) {
        if (!f.hasNearPoint()) {
            return;
        }
        double lat = f.nearLat();
        double lng = f.nearLng();
        double radiusKm = f.effectiveRadiusKm();
        double latRad = Math.toRadians(lat);
        double cosLat = Math.cos(latRad);

        double latDelta = radiusKm / KM_PER_DEGREE;
        // Floored so a search near a pole degenerates into the whole longitude range, not a
        // division by zero.
        double lngDelta = radiusKm / (KM_PER_DEGREE * Math.max(Math.abs(cosLat), 1e-6));

        sql.append(SEP).append(" and ((").append(alias).append(".lat is not null and ")
                .append(within(alias)).append(')').append(SEP)
                .append("      or (").append(alias).append(".lat is null and ")
                .append(nearByLocality(alias)).append("))");

        params.put("latMin", lat - latDelta);
        params.put("latMax", lat + latDelta);
        params.put("lngMin", lng - lngDelta);
        params.put("lngMax", lng + lngDelta);
        params.put("cosLat", cosLat);
        params.put("sinLat", Math.sin(latRad));
        params.put("lngRad", Math.toRadians(lng));
        params.put("cosRadius", Math.cos(radiusKm / EARTH_RADIUS_KM));
    }

    /** The bounding box and the exact circle for one aliased pair of coordinate columns. */
    private static String within(String alias) {
        return ("%1$s.lng is not null"
                + " and %1$s.lat between :latMin and :latMax and %1$s.lng between :lngMin and :lngMax"
                + " and (:cosLat * cos(radians(%1$s.lat)) * cos(radians(%1$s.lng) - :lngRad)"
                + " + :sinLat * sin(radians(%1$s.lat))) >= :cosRadius").formatted(alias);
    }

    /** A seeker names a <em>shortlist</em>, so any entry landing in the circle answers yes. */
    private static String nearByLocality(String alias) {
        String source = "p".equals(alias)
                ? "jsonb_array_elements_text(coalesce(p.localities, '[]'::jsonb)) as e(v)"
                        + " join localities loc on lower(loc.name) = lower(e.v)"
                : "localities loc";
        String match = "p".equals(alias) ? ""
                : " lower(loc.name) = lower(coalesce(%s.locality, '')) and".formatted(alias);
        return "exists (select 1 from %s where%s loc.lat is not null and %s)"
                .formatted(source, match, within("loc"));
    }

    /** Against the ELEMENTS of a jsonb text array, not its serialization — otherwise JSON
     * punctuation becomes matchable and a pattern can span an element boundary. */
    private static String jsonbTextLike(String column) {
        return ("exists (select 1 from jsonb_array_elements_text(coalesce(%s, '[]'::jsonb)) as e(v)"
                + " where lower(e.v) like :q)").formatted(column);
    }

    /** Binding stops the statement being rewritten but leaves {@code %} a wildcard, so the escape
     * happens here — backslash first, or it would escape the escapes. */
    private static String like(String q) {
        String escaped = q.toLowerCase()
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
        return "%" + escaped + "%";
    }
}
