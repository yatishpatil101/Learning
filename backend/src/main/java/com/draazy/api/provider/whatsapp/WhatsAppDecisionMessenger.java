package com.draazy.api.provider.whatsapp;

import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.provider.DecisionMessenger;
import com.draazy.api.provider.ProviderCalls;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** A blank template name means skip: unlike a login, a decision notice can fall back on the in-app row. */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.whatsapp", name = "enabled", havingValue = "true")
class WhatsAppDecisionMessenger implements DecisionMessenger {

    private static final Logger log = LoggerFactory.getLogger(WhatsAppDecisionMessenger.class);

    /** See {@code WhatsAppOtpSender.COUNTRY_CODE}: the upstream normaliser only admits Indian mobiles. */
    private static final String COUNTRY_CODE = "91";

    private static final String OPERATION = DecisionMessenger.IDENTITY_DECISION;

    private final WhatsAppClient client;
    private final WhatsAppProperties props;
    private final ProviderCalls calls;

    WhatsAppDecisionMessenger(WhatsAppClient client, WhatsAppProperties props, ProviderCalls calls) {
        this.client = client;
        this.props = props;
        this.calls = calls;
    }

    @Override
    public void sendIdentityDecision(String mobile, String line) {
        send(OPERATION, "Identity decision", "identity-template-name", props.identityTemplateName(),
                props.identityTemplateLang(), mobile, line);
    }

    @Override
    public boolean sendWaitingDigest(String mobile, String waiting) {
        return send(DecisionMessenger.WAITING_DIGEST, "Waiting digest", "digest-template-name",
                props.digestTemplateName(), props.digestTemplateLang(), mobile, waiting);
    }

    private boolean send(String operation, String what, String property, String template, String lang,
            String mobile, String parameter) {
        if (isBlank(template) || isBlank(lang)) {
            log.info("{} for {} not sent on WhatsApp: {} unset", what, MobileMask.mask(mobile), property);
            calls.record(ProviderCalls.WHATSAPP, operation, ProviderCalls.Outcome.SKIPPED, mobile, null,
                    "template unset", null);
            return false;
        }
        Map<String, Object> payload = Map.of(
                "messaging_product", "whatsapp",
                "recipient_type", "individual",
                "to", COUNTRY_CODE + mobile,
                "type", "template",
                "template", Map.of(
                        "name", template,
                        "language", Map.of("code", lang),
                        "components", List.of(
                                Map.of("type", "body",
                                        "parameters", List.of(Map.of("type", "text", "text", parameter))))));
        try {
            calls.track(ProviderCalls.WHATSAPP, operation, mobile, null,
                    () -> client.post("/" + props.phoneNumberId() + "/messages", payload));
            return true;
        } catch (WhatsAppClient.WhatsAppException e) {
            // Best-effort by contract: the in-app row already carries the news.
            log.warn("{} WhatsApp send failed for {}", what, MobileMask.mask(mobile), e);
            return false;
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
