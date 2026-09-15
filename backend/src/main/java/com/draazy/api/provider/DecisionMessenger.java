package com.draazy.api.provider;

import com.draazy.api.common.trust.MobileMask;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Seam for a business-initiated WhatsApp message that is not a login code. Best-effort and never
 * throws, unlike {@link OtpSender}: a decision notice is duplicated by the in-app inbox row.
 */
public interface DecisionMessenger {

    /**
     * Send {@code line} as the template's single body parameter. Missing configuration or a vendor
     * refusal is logged and swallowed.
     */
    void sendIdentityDecision(String mobile, String line);
}

/**
 * Wherever WhatsApp is off: record that a send would have happened. Not profile-bound — a bean that
 * threw here would roll back the very decision it was announcing.
 */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.whatsapp", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class LoggingDecisionMessenger implements DecisionMessenger {

    private static final Logger log = LoggerFactory.getLogger(LoggingDecisionMessenger.class);

    @Override
    public void sendIdentityDecision(String mobile, String line) {
        log.info("[MOCK WHATSAPP] identity decision to {}: {}", MobileMask.mask(mobile), line);
    }
}
