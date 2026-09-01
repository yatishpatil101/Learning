package com.punenest.api.engagement.pageview;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * Request body for {@code POST /page-views} — a flush of everything one tab has seen since the last
 * one.
 *
 * <p><strong>Why a batch rather than a request per view.</strong> A beacon that fired on every route
 * change would spend a viewer's entire write budget on telemetry: {@code WriteRateLimitFilter}
 * allows 120 mutating requests a minute per caller, shared with every real thing they do, and a
 * session clicking through listings produces route changes at a rate that competes with that. The
 * first casualty would not be the telemetry — it would be the enquiry the viewer tried to send
 * afterwards, refused with a 429 because a beacon had already spent the budget. It would also 429
 * the e2e suite, whose navigation is faster than any human's, and the tests it broke would be
 * unrelated to the change that broke them. Batching turns tens of requests a minute into about four,
 * and needed no exemption from a control that exists for good reasons.
 *
 * <p><strong>Why the session id is on the batch and not on each event.</strong> A flush comes from
 * one tab, and a tab is one session by construction. Repeating it per event would invite a client to
 * send a batch spanning several, which is a shape the reader would then have to defend against for
 * no benefit.
 *
 * @param sessionId opaque tab-scoped token; see {@link PageView#getSessionId()}
 * @param events    the views, oldest first — though nothing depends on the order
 */
public record PageViewBatchCreate(

        // Format-constrained rather than merely bounded. The client mints this, so without a
        // pattern it is a 64-character free-text field on an unauthenticated endpoint — somewhere a
        // careless client could park an email address, and somewhere a hostile one could park
        // anything at all. Restricting it to token characters means whatever arrives cannot be
        // personal data even by accident.
        @NotBlank
        @Pattern(regexp = "[A-Za-z0-9_-]{8,64}",
                message = "sessionId must be an opaque token of 8-64 URL-safe characters")
        String sessionId,

        // Capped because the whole batch is materialised and validated before anything is written.
        // Fifty is far above a real flush (a fifteen-second window produces a handful) and far below
        // a payload worth sending to be expensive.
        @NotEmpty
        @Size(max = 50, message = "a flush carries at most 50 events")
        List<@Valid Item> events) {

    /**
     * One page view within the flush.
     *
     * @param path         the matched route pattern; see {@link PageView#getPath()}
     * @param referrerHost host of the referring page, or null
     * @param device       {@code mobile}, {@code tablet} or {@code desktop}
     * @param agoMs        how long before this flush the view happened
     */
    public record Item(

            @NotBlank
            @Size(max = 200)
            String path,

            @Size(max = 120)
            String referrerHost,

            // @NotBlank as well as @Pattern: a @Pattern passes null by design, so alone it would
            // accept an event with no device at all and defer the failure to the check constraint —
            // a 500 where a 400 belongs.
            @NotBlank
            @Pattern(regexp = "mobile|tablet|desktop",
                    message = "device must be mobile, tablet or desktop")
            String device,

            /*
             * Relative, not absolute, and that is the point.
             *
             * An ISO timestamp from a browser is that browser's clock, which is routinely minutes
             * out and occasionally years out. Day buckets are cut on IST, so a skewed clock does not
             * degrade the data gracefully — it files a view under the wrong day, and a hostile
             * client could backdate a flood into any month it liked. An offset is anchored to the
             * server's clock on arrival, so the worst a wrong client can do is misreport how long
             * ago something happened within its own flush.
             *
             * Rejected when negative, because "in the future" is a broken or hostile client and
             * saying so is more useful than silently accepting it. Clamped rather than rejected when
             * implausibly large, because a tab left idle for hours and flushed on unload is a real
             * session that should be counted, not an error.
             */
            @NotNull
            @PositiveOrZero
            Long agoMs) {
    }
}
