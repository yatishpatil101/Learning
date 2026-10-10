package com.draazy.api.provider;

import com.draazy.api.common.trust.MobileMask;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Best-effort and never throws, unlike {@link OtpSender}: the in-app inbox row
 * duplicates a decision notice. */
public interface DecisionMessenger {

    String IDENTITY_DECISION = "identity-decision";
    String WAITING_DIGEST = "waiting-digest";

    void sendIdentityDecision(String mobile, String line);

    /** Returns whether the vendor accepted it, so the caller can retry later rather than count it as sent. */
    boolean sendWaitingDigest(String mobile, String waiting);
}

/** Not profile-bound: a bean that threw here would roll back the very decision it announces. */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.whatsapp", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class LoggingDecisionMessenger implements DecisionMessenger {

    private static final Logger log = LoggerFactory.getLogger(LoggingDecisionMessenger.class);

    private final ProviderCalls calls;

    LoggingDecisionMessenger(ProviderCalls calls) {
        this.calls = calls;
    }

    @Override
    public void sendIdentityDecision(String mobile, String line) {
        log.info("[MOCK WHATSAPP] identity decision to {}: {}", MobileMask.mask(mobile), line);
        calls.record(ProviderCalls.WHATSAPP, IDENTITY_DECISION, ProviderCalls.Outcome.SKIPPED, mobile, null,
                "mock", null);
    }

    @Override
    public boolean sendWaitingDigest(String mobile, String waiting) {
        log.info("[MOCK WHATSAPP] waiting digest to {}: {}", MobileMask.mask(mobile), waiting);
        calls.record(ProviderCalls.WHATSAPP, WAITING_DIGEST, ProviderCalls.Outcome.SKIPPED, mobile, null,
                "mock", null);
        return false;
    }
}
