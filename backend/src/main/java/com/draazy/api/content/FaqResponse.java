package com.draazy.api.content;

import java.util.Map;

/**
 * Contract {@code Faq} wire shape.
 *
 * @param translations editor-written translations, keyed language then field name (D2) —
 *                     {@code {"mr": {"question": "…", "answer": "…"}}}. Always present, empty when
 *                     nothing has been translated, so a client can read it without a null check and
 *                     without having to tell "untranslated" from "this server is too old to say".
 *                     A language may translate some fields and not others; the client falls back
 *                     per field, not per row, because half a translated FAQ is still better than an
 *                     English one for somebody who cannot read English.
 */
public record FaqResponse(
        String id,
        String question,
        String answer,
        String category,
        Map<String, Map<String, String>> translations) {
}
