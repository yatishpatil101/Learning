package com.punenest.api.admin;

import com.punenest.api.catalog.locality.LocalityRepository;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.engagement.demand.DemandSignalRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The supply-gap report: what is listed against what people asked for, per locality.
 *
 * <p><strong>What this replaces, and why it had to move.</strong> The browser used to build this
 * from four localStorage arrays that only the reading administrator had ever written to, plus 82
 * invented enquiry rows. It therefore reported the searches performed by the person looking at the
 * report, in that browser, since storage was last cleared — a mirror presented as a market. Demand
 * is the one quantity on the platform that is meaningless unless it aggregates across everybody, so
 * it is the one that could least afford to live in a single session.
 *
 * <p><strong>Every locality with either side is reported.</strong> The union matters more than
 * either half: a locality with listings and no demand is inventory nobody wants, and a locality with
 * demand and no listings is the gap the report is named after. Returning only the intersection would
 * hide both of the two findings worth having.
 */
@Service
public class AdminSupplyGapService {

    /** Default window. Matches {@code /admin/analytics} so two tabs do not quietly disagree. */
    private static final int DEFAULT_WINDOW_DAYS = 30;

    /** Guard rail, not a performance limit — a year of demand is a different report. */
    private static final int MAX_WINDOW_DAYS = 365;

    /**
     * How much each kind counts toward {@code demand}.
     *
     * <p>These are a judgement and are named so that they can be argued with. A view is the weakest
     * signal — a visitor may have opened a listing and hated it — so it counts once. A search is a
     * stated intent rather than a reaction, so it counts twice. An alert request is somebody willing
     * to hand over a contact channel to be told when supply appears, which is the strongest thing
     * short of an enquiry, so it counts five times.
     *
     * <p>Weighted on read, never on write: {@code demand_signals} stores one row per event with no
     * weight attached, so changing these numbers re-scores history instead of only affecting rows
     * recorded after the change. That is the whole reason the weighting is not in the writer.
     */
    private static final int WEIGHT_VIEW = 1;
    private static final int WEIGHT_SEARCH = 2;
    private static final int WEIGHT_ALERT = 5;

    private final DemandSignalRepository demand;
    private final PropertyRepository properties;
    private final LocalityRepository localities;

    public AdminSupplyGapService(DemandSignalRepository demand,
                                 PropertyRepository properties,
                                 LocalityRepository localities) {
        this.demand = demand;
        this.properties = properties;
        this.localities = localities;
    }

    /**
     * @param days window in days; null falls back to {@link #DEFAULT_WINDOW_DAYS}
     * @return one row per locality that has supply or demand, widest gap first
     */
    @Transactional(readOnly = true)
    public List<SupplyGapRow> report(Integer days) {
        int window = days == null ? DEFAULT_WINDOW_DAYS : days;
        if (window < 1 || window > MAX_WINDOW_DAYS) {
            throw new BadRequestException("days must be between 1 and " + MAX_WINDOW_DAYS);
        }
        // A rolling instant window rather than a calendar one. /admin/analytics buckets on the
        // Indian calendar because a chart's x-axis is dates; this returns no dates at all, so a
        // calendar boundary would add a timezone question the answer does not depend on.
        Instant since = Instant.now().minus(window, ChronoUnit.DAYS);

        Map<String, Long> supply = new HashMap<>();
        for (Object[] row : properties.countLiveByLocalitySlug("approved")) {
            supply.put((String) row[0], ((Number) row[1]).longValue());
        }

        Map<String, DemandSignalRepository.DemandByLocality> byLocality = new HashMap<>();
        DemandSignalRepository.DemandByLocality unplaced = null;
        for (DemandSignalRepository.DemandByLocality row : demand.aggregateSince(since)) {
            if (row.getLocalitySlug() == null) {
                unplaced = row;
            } else {
                byLocality.put(row.getLocalitySlug(), row);
            }
        }

        // Union, not intersection — see the class docblock. LinkedHashSet so the pre-sort order is
        // deterministic and two identical calls cannot return ties in a different order.
        Set<String> slugs = new LinkedHashSet<>(supply.keySet());
        slugs.addAll(byLocality.keySet());

        Map<String, String> names = new HashMap<>();
        localities.findAllById(slugs).forEach(l -> names.put(l.getSlug(), l.getName()));

        Map<String, Long> seekers = new HashMap<>();
        demand.repeatSeekersSince(since)
                .forEach(r -> seekers.put(r.getLocalitySlug(), r.getSeekers()));

        List<SupplyGapRow> rows = new ArrayList<>(slugs.size() + 1);
        for (String slug : slugs) {
            rows.add(row(slug, names.get(slug), supply.getOrDefault(slug, 0L),
                    byLocality.get(slug), seekers.getOrDefault(slug, 0L)));
        }
        // "Somewhere in the city" last, and with no supply figure, because there is no place to
        // count listings in. Reported rather than dropped: a rise here says people are arriving
        // without a locality in mind, which is a discovery problem rather than a supply one.
        //
        // No repeat-seeker figure either: "searched the same locality three times" cannot be said
        // of searches that named no locality.
        if (unplaced != null) {
            rows.add(row(null, null, 0L, unplaced, 0L));
        }

        rows.sort((a, b) -> Long.compare(b.gap(), a.gap()));
        return rows;
    }

    private static SupplyGapRow row(String slug, String name, long supply,
                                    DemandSignalRepository.DemandByLocality d, long repeatSeekers) {
        long searches = d == null ? 0 : d.getSearches();
        long alerts = d == null ? 0 : d.getAlerts();
        long views = d == null ? 0 : d.getViews();
        long weighted = searches * WEIGHT_SEARCH + alerts * WEIGHT_ALERT + views * WEIGHT_VIEW;
        return new SupplyGapRow(slug, name, supply, searches, alerts, views, repeatSeekers,
                weighted, weighted - supply);
    }
}
