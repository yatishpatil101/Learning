package com.draazy.api.catalog.locality;

import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/**
 * Normalizes a free-text locality into a <em>curated</em> locality slug — the server-side counterpart
 * of the frontend's {@code resolveLocalitySlug(name, lat, lng)}.
 *
 * <p><strong>Why this exists.</strong> Owners type their locality by hand in the listing wizard.
 * "Hinjewadi", "hinjawadi ", and "Hinjawadi Phase 1" are the same market to a buyer but three
 * different strings, and {@code properties.locality} (the display name) has no uniqueness or
 * normalization guarantee. Every locality-scoped surface — search facets, {@code /locality/{slug}}
 * pages, saved-search alerts, society↔locality joins — keys off {@code locality_slug}. A listing that
 * never gets a slug is <em>invisible</em> to all of them while still looking fine on its own detail
 * page, which is the worst kind of bug: silent, and it costs the owner their leads.
 *
 * <p><strong>Resolution ladder</strong> (first hit wins, mirroring the client so the two agree):
 *
 * <ol>
 *   <li><em>Slugified name is an exact PK hit.</em> Handles the canonical case and anything the
 *       client already normalized.
 *   <li><em>Case-insensitive display-name match.</em> Catches names whose slug differs from a naive
 *       slugify (e.g. "NIBM Road").
 *   <li><em>Containment, both directions, on names ≥ 5 chars.</em> Snaps "Hinjawadi Phase 1" up to
 *       "Hinjawadi". The length floor stops short names (Sus, Maan) from over-matching — a
 *       deliberate copy of the client's guard rather than a re-derivation.
 *   <li><em>Nearest curated locality within {@value #GEO_SNAP_KM} km.</em> Only when coordinates were
 *       supplied. The tight radius is intentional: this binds a listing to a market, so a wrong snap
 *       is worse than no snap.
 * </ol>
 *
 * <p><strong>Why {@code null} rather than a coined slug.</strong> {@code properties.locality_slug} is
 * FK-constrained to {@code localities(slug)}, so inventing {@code slugify(name)} would either violate
 * the constraint or force auto-creating locality rows from owner typos — permanently polluting the
 * reference table (and the sitemap) with junk pages. Returning {@code null} keeps the catalogue
 * honest: the listing is {@code pending} moderation anyway, so an unresolved locality is a curation
 * task for a human, not a data-integrity problem. This is the one place the client's behaviour is
 * deliberately <em>not</em> mirrored — it may fall back to a coined slug because it has no FK to
 * satisfy.
 */
@Service
public class LocalityResolver {

    /**
     * Max distance for the coordinate fallback. Matches the client's listing-bind gate; localities in
     * Pune are ~2–4 km across, so a wider radius would start binding listings to the neighbouring
     * market.
     */
    static final double GEO_SNAP_KM = 2.5;

    /** Below this, containment matching is off — see the ladder's step 3. */
    private static final int MIN_CONTAINS_LENGTH = 5;

    private static final double EARTH_RADIUS_KM = 6371.0;

    private final LocalityRepository localities;

    public LocalityResolver(LocalityRepository localities) {
        this.localities = localities;
    }

    /**
     * Resolve a display name (with optional coordinates) to a curated locality slug.
     *
     * @param name display locality as typed/picked, nullable
     * @return the curated slug, or {@code null} when nothing matched confidently
     */
    @Transactional(readOnly = true)
    public String resolve(String name, Double lat, Double lng) {
        if (StringUtils.hasText(name)) {
            String slug = byName(name.trim());
            if (slug != null) {
                return slug;
            }
        }
        return byCoordinates(lat, lng);
    }

    /** Steps 1–3 of the ladder: everything that can be decided from the name alone. */
    private String byName(String name) {
        Optional<Locality> exact = localities.findBySlugAndActiveTrue(slugify(name));
        if (exact.isPresent()) {
            return exact.get().getSlug();
        }
        List<Locality> byDisplayName = localities.findByNameIgnoreCaseAndActiveTrue(name);
        if (!byDisplayName.isEmpty()) {
            return byDisplayName.get(0).getSlug();
        }
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.length() < MIN_CONTAINS_LENGTH) {
            return null;
        }
        return localities.findByActiveTrue().stream()
                .filter(l -> contains(lower, l.getName().toLowerCase(Locale.ROOT)))
                .findFirst()
                .map(Locality::getSlug)
                .orElse(null);
    }

    /** Step 4: nearest active locality with coordinates, inside {@link #GEO_SNAP_KM}. */
    private String byCoordinates(Double lat, Double lng) {
        if (lat == null || lng == null) {
            return null;
        }
        Locality best = null;
        double bestKm = Double.MAX_VALUE;
        for (Locality l : localities.findByActiveTrue()) {
            if (l.getLat() == null || l.getLng() == null) {
                continue;
            }
            double km = haversineKm(lat, lng, l.getLat(), l.getLng());
            if (km < bestKm) {
                bestKm = km;
                best = l;
            }
        }
        return best != null && bestKm <= GEO_SNAP_KM ? best.getSlug() : null;
    }

    /** Containment in either direction, with the short-name guard applied to the candidate too. */
    private static boolean contains(String typedLower, String candidateLower) {
        return candidateLower.length() >= MIN_CONTAINS_LENGTH
                && (typedLower.contains(candidateLower) || candidateLower.contains(typedLower));
    }

    /** Same rule as the client's {@code slugifyLocality}: lowercase, non-alphanumerics → single dash. */
    static String slugify(String name) {
        return name.toLowerCase(Locale.ROOT)
                .trim()
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
    }

    /** Great-circle distance in km. */
    private static double haversineKm(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                        * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
