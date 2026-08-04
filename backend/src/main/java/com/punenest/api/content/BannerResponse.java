package com.punenest.api.content;

/**
 * Contract {@code Banner} wire shape.
 */
public record BannerResponse(
        String id,
        String image,
        String link,
        String headline,
        int position) {
}
