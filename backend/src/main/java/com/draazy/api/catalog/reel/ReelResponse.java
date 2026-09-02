package com.draazy.api.catalog.reel;

import java.util.UUID;

/**
 * The contract's {@code Reel}.
 *
 * @param listingId the property it was filmed at, or {@code null} if that listing is gone
 * @param title     caption as published
 * @param locality  locality as captioned on the reel — a display label ("Hinjawadi"), not a slug,
 *                  and not guaranteed to match a curated locality
 * @param price     whole rupees, as published with the clip
 * @param deal      {@code buy} or {@code rent}
 * @param poster    thumbnail image url
 * @param video     video url
 * @param tag       editorial tag, e.g. {@code Trending}
 */
public record ReelResponse(
        UUID id,
        UUID listingId,
        String title,
        String locality,
        Long price,
        String deal,
        String poster,
        String video,
        int likes,
        int views,
        String tag) {
}
