package com.draazy.api.catalog.society;

import com.draazy.api.common.error.ValidationException;
import com.draazy.api.provider.PlacesLookup.Place;
import java.util.List;
import java.util.Set;

/** What a Google place must be to become a society: in a served city, and a building. */
final class SocietyPlaceRules {

    // Pune, the box frontend/src/lib/geoConfig.js serves: south, north, west, east.
    private static final double SOUTH = 18.38;
    private static final double NORTH = 18.72;
    private static final double WEST = 73.68;
    private static final double EAST = 74.02;

    private static final Set<String> AREA_TYPES = Set.of(
            "locality", "political", "route", "postal_code", "country", "neighborhood", "plus_code", "geocode");

    private static final Set<String> NOT_RESIDENTIAL = Set.of(
            "restaurant", "cafe", "bar", "bakery", "meal_takeaway", "meal_delivery", "food", "night_club",
            "store", "shopping_mall", "supermarket", "convenience_store", "clothing_store",
            "lodging", "hospital", "health", "doctor", "pharmacy", "school", "university",
            "bank", "atm", "finance", "gas_station", "place_of_worship", "hindu_temple", "church", "mosque",
            "gym", "movie_theater", "corporate_office");

    private static final Set<String> BUILDING_TYPES = Set.of("premise", "subpremise");

    private SocietyPlaceRules() {
    }

    /** A pin we have been given; absent coordinates are not a reason to refuse. */
    static void requireServed(Double lat, Double lng) {
        if (lat == null || lng == null) {
            return;
        }
        if (lat < SOUTH || lat > NORTH || lng < WEST || lng > EAST) {
            throw new ValidationException("We only list societies in cities we serve.");
        }
    }

    static void requireBuilding(Place place) {
        List<String> types = place.types();
        if (types.isEmpty()) {
            return;
        }
        if (types.stream().allMatch(SocietyPlaceRules::isAreaType)) {
            throw new ValidationException("Pick your building, not an area.");
        }
        if (types.stream().anyMatch(NOT_RESIDENTIAL::contains)
                && types.stream().noneMatch(BUILDING_TYPES::contains)) {
            throw new ValidationException("Pick your building, not a shop or office.");
        }
    }

    private static boolean isAreaType(String type) {
        return AREA_TYPES.contains(type) || type.startsWith("sublocality") || type.startsWith("administrative_area_level_");
    }
}
