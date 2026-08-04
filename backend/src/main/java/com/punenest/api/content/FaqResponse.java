package com.punenest.api.content;

/**
 * Contract {@code Faq} wire shape.
 */
public record FaqResponse(
        String id,
        String question,
        String answer,
        String category) {
}
