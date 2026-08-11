package com.punenest.api.security;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * The bot defence that is in force when none is configured: none (tech-debt D130).
 *
 * <p>This is the default bean — {@code matchIfMissing = true} — so a machine with no Turnstile
 * secret, the whole test suite, and any environment where the flag was never set all run with the
 * challenge switched off and pay nothing for it. See {@link BotDefence} for why "not configured"
 * fails open while "configured and failing" fails closed.
 *
 * <p><strong>Why a no-op bean rather than a null check.</strong> A conditional bean means the
 * decision is made once, at startup, from configuration — not on every request from a field that
 * some future edit could leave in an unexpected state. {@link BotDefenceFilter} then has exactly one
 * shape regardless of how the platform is configured, so the enabled and disabled paths cannot drift
 * apart. It also means the disabled case is a code path that runs constantly rather than one that is
 * only exercised in production.
 */
@Component
@ConditionalOnProperty(prefix = "punenest.security.turnstile", name = "enabled",
        havingValue = "false", matchIfMissing = true)
public class NoopBotDefence implements BotDefence {

    @Override
    public boolean enforced() {
        return false;
    }

    /**
     * Never called: {@link BotDefenceFilter} short-circuits on {@link #enforced()}.
     *
     * <p>Returns {@code true} rather than throwing so that a future caller which forgets to check
     * {@code enforced()} first fails open in the unconfigured case, which is the direction this
     * bean's whole existence commits to. The enforcing implementation makes the opposite choice for
     * the same reason.
     */
    @Override
    public boolean verify(String token, String remoteIp) {
        return true;
    }
}
