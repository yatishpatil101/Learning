package com.draazy.api.catalog.locality;

public record LocalitySummary(String slug, String name, String city, Double lat, Double lng) {

    static LocalitySummary of(Locality l) {
        return new LocalitySummary(l.getSlug(), l.getName(), l.getCity(), l.getLat(), l.getLng());
    }
}