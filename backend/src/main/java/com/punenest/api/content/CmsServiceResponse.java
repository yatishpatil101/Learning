package com.punenest.api.content;

/**
 * Contract {@code CmsService} wire shape.
 */
public record CmsServiceResponse(
        String id,
        String name,
        String icon,
        String description,
        String link) {
}
