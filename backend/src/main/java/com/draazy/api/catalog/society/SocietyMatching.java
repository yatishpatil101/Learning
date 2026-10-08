package com.draazy.api.catalog.society;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/** The name and distance maths behind duplicate hints and the Google-pick resolver. */
final class SocietyMatching {

    /** The weakest resemblance worth showing: two of five distinct words, or one of two, but not one of three. */
    static final double FLOOR = 0.34;

    /** Sharing a locality is not proof (two societies can share a road), but it lifts one shared word over the floor. */
    static final double LOCALITY_BOOST = 0.25;

    /** Pins this close are very probably one building. */
    static final double NEAR_BOOST = 0.25;

    static final double NEAR_METRES = 100;

    static final double NEARBY_METRES = 250;

    // Half-widths of the 250 m box at Pune's latitude (~18.5 N); the exact haversine filters the corners.
    static final double LAT_BOX = 0.00225;

    static final double LNG_BOX = 0.0024;

    private static final double EARTH_RADIUS_METRES = 6_371_000;

    // Every third Pune building is a Residency and every second ends in CHS: those are not evidence.
    private static final Set<String> NAME_STOPWORDS = Set.of(
            "the", "of", "by", "and", "society", "apartments", "apartment", "residency",
            "residences", "homes", "phase", "wing", "tower", "towers", "co", "op", "chs",
            "ltd", "pune");

    private SocietyMatching() {
    }

    /** The distinctive words in a name; single characters (wing letters) go too. */
    static Set<String> tokens(String name) {
        return Arrays.stream((name == null ? "" : name)
                        .toLowerCase(Locale.ROOT).split("[^a-z0-9]+"))
                .filter(t -> t.length() > 1 && !NAME_STOPWORDS.contains(t))
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    /** Shared words over the words in either name, not the shorter one, which scores a short name 1.0 against every longer one;
     * deliberately loose, as a false candidate costs one click and a miss mints a duplicate. */
    static double nameScore(Set<String> mine, Set<String> theirs) {
        long shared = theirs.stream().filter(mine::contains).count();
        long union = mine.size() + theirs.size() - shared;
        return union == 0 ? 0 : (double) shared / union;
    }

    static double metresBetween(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(a));
    }
}
