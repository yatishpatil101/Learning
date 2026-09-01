package com.punenest.api.engagement.history;

import java.time.Instant;

/**
 * One entry in the signed-in "resume your search" rail.
 *
 * @param label what the user saw on the chip, e.g. {@code "Rent · 2 BHK · Baner"}
 * @param url   a relative URL on one of our own search pages; the identity of the entry
 * @param at    when the user last ran this search, set by the server. The frontend maps it to epoch
 *              milliseconds so the rail's relative-time formatting keeps working unchanged.
 */
public record RecentSearchDto(String label, String url, Instant at) {
}
