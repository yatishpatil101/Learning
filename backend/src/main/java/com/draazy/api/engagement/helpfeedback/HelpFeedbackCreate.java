package com.draazy.api.engagement.helpfeedback;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Request body for {@code POST /help/feedback}. */
public record HelpFeedbackCreate(

        // Mirrors the column's CHECK, which is shape-constrained because this is the key a
        // back-office screen will group and link on.
        @NotBlank
        @Size(max = 120)
        @Pattern(regexp = "[a-z0-9-]+", message = "slug must be lower-case letters, digits and hyphens")
        String slug,

        // The set the database CHECK allows, stated here so a bad value is a 422 naming the field
        // rather than a 500 from a constraint violation.
        @NotBlank
        @Pattern(regexp = "en|hi|mr", message = "lang must be en, hi or mr")
        String lang,

        // Boxed and @NotNull: a primitive would default a missing field to false, filing a client omission
        // as a genuine "did not help" verdict.
        @NotNull
        Boolean helpful,

        // Matches the column's CHECK; the cap keeps an anonymous endpoint from storing arbitrary documents.
        @Size(max = 500)
        String comment,

        // The browser's random id, so signed-out readers behind one shared IP still count separately.
        @Pattern(regexp = "[0-9a-fA-F-]{36}", message = "voter must be a UUID")
        String voter) {
}
