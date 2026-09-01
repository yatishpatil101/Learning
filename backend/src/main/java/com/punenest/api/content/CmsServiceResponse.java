package com.punenest.api.content;

import java.util.Map;

/**
 * Contract {@code CmsService} wire shape.
 *
 * @param translations editor-written translations, keyed language then field name — see
 *                     {@link FaqResponse}
 */
public record CmsServiceResponse(
        String id,
        String name,
        String icon,
        String description,
        String link,
        Map<String, Map<String, String>> translations) {
}
