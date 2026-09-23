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

        // Boxed and @NotNull rather than primitive: a primitive would silently default a missing
        // field to false, filing "the client forgot to send the verdict" as "this article did not
        // help" — the one wrong answer that looks exactly like a real one.
        @NotNull
        Boolean helpful,

        // Matches the column's CHECK. Bounded rather than forbidden: the cap is only there so an
        // anonymous endpoint cannot be used to store an arbitrary document.
        @Size(max = 500)
        String comment) {
}
