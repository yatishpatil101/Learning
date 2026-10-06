package com.draazy.api.engagement.pageview;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;

/** A batch, as a beacon per route change would spend the viewer's {@code WriteRateLimitFilter} budget (and 429 the e2e suite);
 * the session id is on the batch because a flush comes from one tab, which is one session. */
public record PageViewBatchCreate(

        // Token characters only, so whatever arrives on this unauthenticated field can't be personal data.
        @NotBlank
        @Pattern(regexp = "[A-Za-z0-9_-]{8,64}",
                message = "sessionId must be an opaque token of 8-64 URL-safe characters")
        String sessionId,

        // Capped because the whole batch is materialised and validated before writing; a real flush is a handful.
        @NotEmpty
        @Size(max = 50, message = "a flush carries at most 50 events")
        List<@Valid Item> events,

        Boolean attributed) {

    public record Item(

            @NotBlank
            @Size(max = 200)
            String path,

            @Size(max = 120)
            String referrerHost,

            // @NotBlank as well as @Pattern: @Pattern passes null, which would defer the failure to the check constraint
            // as a 500 where a 400 belongs.
            @NotBlank
            @Pattern(regexp = "mobile|tablet|desktop",
                    message = "device must be mobile, tablet or desktop")
            String device,

            /* Relative, not absolute: browser clocks skew and days are cut on IST, so the offset is anchored
               to the server clock; implausibly large values are clamped. */
            @NotNull
            @PositiveOrZero
            Long agoMs) {
    }
}
