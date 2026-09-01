package com.punenest.api.common.trust;

/**
 * Whether a projection may carry back-office-only state, or must omit it.
 *
 * <p>A second axis alongside {@link ContactVisibility} rather than a reuse of it, because the two
 * decisions genuinely differ: the moderation queue renders {@code MASKED} — an ops screen has no
 * need of owners' raw numbers in bulk — while still being the one audience allowed to see the
 * onboarding funnel. Folding them together would have made "staff" and "may see the phone number"
 * the same question, and the queue is the counter-example.
 *
 * <p>A two-valued type rather than a {@code boolean} for the same reason as its neighbour: it
 * travels through MapStruct as a {@code @Context} argument, and {@code toResponse(p, MASKED, false)}
 * says nothing about what the {@code false} governs.
 *
 * <p>What it guards is small but not cosmetic. {@code adminPipeline} says which listings the
 * platform manufactured on an owner's behalf rather than received from them, and how far through
 * being handed over each one is. That is commercially revealing about supply, and it names the
 * staff member who did it. It is for the desk that does the work, not for everyone browsing.
 */
public enum BackOfficeVisibility {

    /** Omit back-office state. The default for every consumer and owner-facing surface. */
    HIDDEN,

    /** Emit back-office state. Only ever reached behind a staff/admin authorisation guard. */
    VISIBLE
}
