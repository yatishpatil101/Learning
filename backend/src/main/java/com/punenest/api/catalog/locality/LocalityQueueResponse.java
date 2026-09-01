package com.punenest.api.catalog.locality;

import java.util.List;

/**
 * The locality curation queue: a capped page of listings, and how many there really are.
 *
 * <p><strong>Why {@code total} is on the wire and not left to the array's length.</strong> This
 * queue is unbounded by nature — the resolver declines to coin a slug whenever it is not confident,
 * so a geocoding outage or one bad import puts a day's listings in here at once. A console that
 * renders {@code listings.length} as "12 awaiting" when the cap silently truncated 431 is worse
 * than no number at all: it tells the operator the job is nearly done on precisely the day it is
 * not. The two fields together let the page say "showing 200 of 431", which is the honest sentence.
 *
 * @param total    how many listings are awaiting a locality, uncapped
 * @param listings the oldest of them, capped
 */
public record LocalityQueueResponse(long total, List<LocalityQueueEntry> listings) {
}
