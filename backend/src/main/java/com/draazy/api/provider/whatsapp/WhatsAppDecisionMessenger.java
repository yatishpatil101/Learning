package com.draazy.api.provider.whatsapp;

import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.provider.DecisionMessenger;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Identity-verification decisions as a WhatsApp {@code UTILITY} template. A blank template name
 * means "skip": unlike a login, a decision notice can fall back on the in-app row.
 */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.whatsapp", name = "enabled", havingValue = "true")
class WhatsAppDecisionMessenger implements DecisionMessenger {

    private static final Logger log = LoggerFactory.getLogger(WhatsAppDecisionMessenger.class);

    /** See {@code WhatsAppOtpSender.COUNTRY_CODE}: the upstream normaliser only admits Indian mobiles. */
    private static final String COUNTRY_CODE = "91";

    private final WhatsAppClient client;
    private final WhatsAppProperties props;

    WhatsAppDecisionMessenger(WhatsAppClient client, WhatsAppProperties props) {
        this.client = client;
        this.props = props;
    }

    @Override
    public void sendIdentityDecision(String mobile, String line) {
        if (isBlank(props.identityTemplateName()) || isBlank(props.identityTemplateLang())) {
            log.info("Identity decision for {} not sent on WhatsApp: identity-template-name unset",
                    MobileMask.mask(mobile));
            return;
        }
        Map<String, Object> payload = Map.of(
                "messaging_product", "whatsapp",
                "recipient_type", "individual",
                "to", COUNTRY_CODE + mobile,
                "type", "template",
                "template", Map.of(
                        "name", props.identityTemplateName(),
                        "language", Map.of("code", props.identityTemplateLang()),
                        "components", List.of(
                                Map.of("type", "body",
                                        "parameters", List.of(Map.of("type", "text", "text", line))))));
        try {
            client.post("/" + props.phoneNumberId() + "/messages", payload);
        } catch (WhatsAppClient.WhatsAppException e) {
            // Best-effort by contract: the decision is already committed and visible in-app.
            log.warn("Identity decision WhatsApp send failed for {}", MobileMask.mask(mobile), e);
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
