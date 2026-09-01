package com.punenest.api.content;

import java.util.Map;

/**
 * Contract {@code Banner} wire shape.
 *
 * @param translations editor-written translations, keyed language then field name — see
 *                     {@link FaqResponse}
 */
public record BannerResponse(
        String id,
        String image,
        String link,
        String headline,
        int position,
        Map<String, Map<String, String>> translations) {
}
