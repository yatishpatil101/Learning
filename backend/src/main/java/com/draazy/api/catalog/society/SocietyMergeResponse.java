package com.draazy.api.catalog.society;

import java.time.Instant;

/** Not a field on {@link SocietyResponse}: {@code mergedInto} would be null on every public read, which excludes
 * merged-away rows. Both sides carry a name because near-identical slugs are how duplicates arise. */
public record SocietyMergeResponse(
        String slug,
        String name,
        String intoSlug,
        String intoName,
        Instant mergedAt) {
}
