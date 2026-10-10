package com.draazy.api.moderation.enquiry;

import java.util.List;
import java.util.Map;

/** Counts keyed by status plus {@code all}; the funnel is scoped by the request's {@code days}, {@code deal}. */
public record AdminEnquirySummary(
        Map<String, Long> enquiries,
        Map<String, Long> visits,
        Map<String, Long> deals,
        Map<String, Long> dealTypes,
        long gmv,
        Funnel funnel) {

    public record Funnel(long enquiries, long visits, long dealsClosed, long gmv, List<Locality> localities) {
    }

    public record Locality(String locality, long enquiries, long visits, long deals, long gmv) {
    }
}
