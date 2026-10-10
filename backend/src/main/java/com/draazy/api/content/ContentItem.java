package com.draazy.api.content;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Map;
import java.util.UUID;

/** The FAQ shape; {@code type} stays on the wire because the admin route is still keyed by it. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ContentItem(
        UUID id,
        String type,
        boolean archived,
        String question,
        String answer,
        String category,
        Map<String, Map<String, String>> translations) {

    /** A list row: translations are authoring data the console never reads, so they travel only on request. */
    ContentItem withoutTranslations() {
        return new ContentItem(id, type, archived, question, answer, category, null);
    }

    static ContentItem from(FaqEntity f) {
        return new ContentItem(f.getId(), ContentTypes.FAQS, f.isArchived(), f.getQuestion(), f.getAnswer(),
                f.getCategory(), f.getTranslations());
    }
}