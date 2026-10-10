package com.draazy.api.catalog.locality;

import com.draazy.api.common.error.ServiceUnavailableException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.provider.PlacesLookup;
import com.draazy.api.provider.PlacesLookup.Place;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/** Typed text never creates a locality: a dormant curated row of the same name is revived before one is minted.
 * A retired row is never reopened by a pick. */
@Service
public class LocalityPlaceService {

    static final String PICK_MESSAGE = "Pick the locality from the suggestions.";

    static final String CLOSED_MESSAGE = "That area isn't open for new listings.";

    static final String OUTSIDE_AREA_MESSAGE = "Pick a locality in Pune.";

    private static final String ACTIVE_CITY = "Pune";
    private static final double SOUTH = 18.25;
    private static final double NORTH = 18.95;
    private static final double WEST = 73.30;
    private static final double EAST = 74.35;
    private static final double NEARBY_KM = 2.5;
    private static final double EARTH_RADIUS_KM = 6371.0;
    private static final int MAX_SLUG_ATTEMPTS = 20;
    private static final int MAX_SEARCH = 20;
    private static final int REJECTED_CAPACITY = 10_000;
    private static final Set<String> RESERVED_SLUGS = Set.of("search", "resolve");

    private static final Logger log = LoggerFactory.getLogger(LocalityPlaceService.class);

    private final LocalityRepository localities;
    private final PlacesLookup places;
    private final TransactionTemplate tx;
    private final RejectedPlaces rejected = new RejectedPlaces(REJECTED_CAPACITY, Duration.ofHours(24), Clock.systemUTC());

    public LocalityPlaceService(LocalityRepository localities, PlacesLookup places, TransactionTemplate tx) {
        this.localities = localities;
        this.places = places;
        this.tx = tx;
    }

    /** Deliberately not one transaction: the Google call must not hold a database connection. */
    public LocalitySummary resolve(LocalityResolveRequest request) {
        String placeId = request.placeId().trim();
        LocalitySummary known = tx.execute(status -> known(placeId));
        if (known != null) {
            return known;
        }
        Place place = verified(placeId, request);
        if (!place.placeId().equals(placeId)) {
            known = tx.execute(status -> known(place.placeId()));
            if (known != null) {
                return known;
            }
        }
        String slug = slugify(place.name());
        if (slug.isEmpty()) {
            throw new ValidationException(PICK_MESSAGE);
        }
        LocalitySummary saved = tx.execute(status -> adoptOrMint(place, slug));
        if (saved == null) {
            throw new ServiceUnavailableException("Could not save that locality. Please try again.");
        }
        return saved;
    }

    @Transactional(readOnly = true)
    public List<LocalitySummary> search(String q, int limit) {
        String text = q == null ? "" : q.replaceAll("[%_\\\\]", "").trim();
        if (text.isEmpty()) {
            return List.of();
        }
        int size = Math.max(1, Math.min(limit, MAX_SEARCH));
        return localities.searchLive(text, PageRequest.of(0, size)).stream().map(LocalitySummary::of).toList();
    }

    private LocalitySummary known(String placeId) {
        return localities.findByPlaceId(placeId).map(this::open).map(LocalitySummary::of).orElse(null);
    }

    private Locality open(Locality l) {
        if (l.isArchived()) {
            throw new ValidationException(CLOSED_MESSAGE);
        }
        return l;
    }

    private LocalitySummary adoptOrMint(Place place, String slug) {
        LocalitySummary known = known(place.placeId());
        if (known != null) {
            return known;
        }
        Optional<Locality> twin = localities.findByNameIgnoreCaseAndArchivedAtIsNull(place.name()).stream()
                .filter(l -> near(l, place)).findFirst();
        if (twin.isPresent()) {
            return LocalitySummary.of(twin.get());
        }
        if (!RESERVED_SLUGS.contains(slug)) {
            Optional<Locality> sameSlug = localities.findById(slug).filter(l -> l.getPlaceId() == null && near(l, place));
            if (sameSlug.isPresent() && sameSlug.get().isActive() && sameSlug.get().isArchived()) {
                throw new ValidationException(CLOSED_MESSAGE);
            }
            if (sameSlug.isPresent() && localities.adopt(slug, place.placeId(), place.name(), place.lat(), place.lng()) == 1) {
                return LocalitySummary.of(localities.findById(slug).orElseThrow());
            }
        }
        for (int n = RESERVED_SLUGS.contains(slug) ? 2 : 1, tried = 0; tried < MAX_SLUG_ATTEMPTS; n++, tried++) {
            String candidate = n == 1 ? slug : slug + "-" + n;
            if (localities.mint(candidate, place.name(), ACTIVE_CITY, place.placeId(), place.lat(), place.lng()) == 1) {
                return LocalitySummary.of(localities.findById(candidate).orElseThrow());
            }
            known = known(place.placeId());
            if (known != null) {
                return known;
            }
        }
        return null;
    }

    private static boolean near(Locality l, Place place) {
        return l.getLat() == null || l.getLng() == null
                || haversineKm(l.getLat(), l.getLng(), place.lat(), place.lng()) <= NEARBY_KM;
    }

    private Place verified(String placeId, LocalityResolveRequest request) {
        if (rejected.contains(placeId)) {
            throw new ValidationException(PICK_MESSAGE);
        }
        Place hint = new Place(placeId, request.name(), request.lat(), request.lng(), null, request.types());
        Place place;
        try {
            place = places.details(placeId, hint).orElseThrow(() -> refused(placeId, PICK_MESSAGE));
        } catch (PlacesLookup.UnavailableException e) {
            log.warn("Places lookup unavailable: {}", e.getMessage());
            throw new ServiceUnavailableException("Locality search is temporarily unavailable.");
        }
        if (place.types().stream().noneMatch(LocalityPlaceService::isLocalityType)
                || place.name().strip().equalsIgnoreCase(ACTIVE_CITY)) {
            throw refused(placeId, PICK_MESSAGE);
        }
        if (!served(place)) {
            throw refused(placeId, OUTSIDE_AREA_MESSAGE);
        }
        return place;
    }

    private ValidationException refused(String placeId, String message) {
        rejected.add(placeId);
        return new ValidationException(message);
    }

    private static boolean served(Place place) {
        return place.lat() != null && place.lng() != null
                && place.lat() >= SOUTH && place.lat() <= NORTH
                && place.lng() >= WEST && place.lng() <= EAST;
    }

    private static boolean isLocalityType(String type) {
        return type.equals("locality") || type.equals("neighborhood") || type.startsWith("sublocality");
    }

    static String slugify(String name) {
        return name.toLowerCase(Locale.ROOT).trim()
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
    }

    private static double haversineKm(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                        * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}