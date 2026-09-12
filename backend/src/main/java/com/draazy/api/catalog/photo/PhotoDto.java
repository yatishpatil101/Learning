package com.draazy.api.catalog.photo;

/**
 * The result of a photo upload: the permanent, world-readable CDN URL the client stores in a
 * listing's {@code images}.
 *
 * <p>A single field rather than the richer {@code DocumentDto}, because a photo is not a tracked
 * row: nothing here owns its lifecycle, it lists nowhere, and it deletes nowhere. The upload swaps
 * the front end's throwaway {@code data:} URL for a real hosted one and its job is done; the URL
 * then travels with the listing through the normal create/update contract like any other image URL.
 *
 * @param url the public CDN URL of the stored photo
 */
public record PhotoDto(String url) {
}
