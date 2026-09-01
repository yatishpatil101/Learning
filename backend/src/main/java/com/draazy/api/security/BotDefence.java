package com.draazy.api.security;

/**
 * Bot defence for the handful of writes that anyone on the internet may post to (tech-debt D130).
 *
 * <p><strong>Why this is a seam and not a call to Cloudflare.</strong> The security package is the
 * shared kernel: it may not import a feature context, and it must not know that the answer today is
 * Turnstile. It declares the question — "was this request made by a person?" — and a provider
 * answers it. The real implementation lives in {@code com.draazy.api.provider.turnstile}, which
 * imports this; nothing here imports that.
 *
 * <p><strong>The asymmetry is the whole design, so it is stated once, here.</strong> There are two
 * ways a challenge can be absent: it can be switched off, or it can be switched on and fail. Those
 * must be handled in opposite directions, and conflating them is the classic way a bot defence ends
 * up decorative.
 *
 * <ul>
 *   <li><strong>Not configured → fail open.</strong> {@link #enforced()} is {@code false}, every
 *       request passes untouched, and no HTTP call is made. This is the default and it is what a
 *       developer's machine, the test suite and any environment without a site key run. A control
 *       nobody has configured must not break the product.</li>
 *   <li><strong>Configured → fail closed.</strong> Once {@link #enforced()} is {@code true}, a
 *       missing token, a token Cloudflare rejects, and a Cloudflare that does not answer are all
 *       the same answer: refuse. This is the direction that costs real users a form submission
 *       during a Cloudflare outage, and it is chosen deliberately. The alternative — letting
 *       requests through when verification errors — means an attacker who can make the verification
 *       endpoint unreachable (or simply send a malformed token that trips an exception path) has
 *       switched the defence off. A control that an attacker can disable by breaking it is not a
 *       control, and the failure would be silent: the forms would keep working, so nobody would
 *       look.</li>
 * </ul>
 *
 * <p>Which endpoints this applies to, and why it must never apply to authenticated ones, is in
 * {@link BotDefenceFilter}.
 */
public interface BotDefence {

    /**
     * Whether this instance actually challenges anything.
     *
     * <p>Read by {@link BotDefenceFilter} <em>before</em> it looks for a token, because "no token
     * supplied" is only a rejection reason when a token was being demanded. Splitting this out of
     * {@link #verify} is what keeps the fail-open and fail-closed branches from having to be
     * distinguished by inspecting a boolean result whose two {@code false}s would mean opposite
     * things.
     *
     * @return {@code true} when a valid token is required, {@code false} for the unconfigured no-op
     */
    boolean enforced();

    /**
     * Check one token with the challenge provider.
     *
     * <p>Implementations must not throw: a provider that is down, slow or returning nonsense is an
     * expected operating condition, not a bug, and it is reported as {@code false} so the caller
     * cannot accidentally turn it into a 500. Anything worth knowing about the failure is logged by
     * the implementation.
     *
     * @param token    the opaque token the widget produced, never {@code null} or blank — the filter
     *                 rejects those before calling, so an implementation never has to decide what a
     *                 missing token means
     * @param remoteIp the caller's address as the server resolved it, or {@code null} if unknown.
     *                 Passed to the provider as a corroborating signal only; it is never trusted
     *                 here and a wrong value must not by itself fail a verification
     * @return {@code true} only if the provider affirmatively confirmed the token
     */
    boolean verify(String token, String remoteIp);
}
