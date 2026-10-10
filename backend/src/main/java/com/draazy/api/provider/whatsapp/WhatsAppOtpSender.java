package com.draazy.api.provider.whatsapp;

import com.draazy.api.provider.OtpSender;
import com.draazy.api.provider.ProviderCalls;
import jakarta.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

// Delivers login codes as a WhatsApp `AUTHENTICATION` template through the Meta Cloud API (ADR-020).
@Component
@ConditionalOnProperty(prefix = "draazy.providers.whatsapp", name = "enabled", havingValue = "true")
class WhatsAppOtpSender implements OtpSender {

    private static final String COUNTRY_CODE = "91";

    private final WhatsAppClient client;
    private final WhatsAppProperties props;
    private final ProviderCalls calls;

    WhatsAppOtpSender(WhatsAppClient client, WhatsAppProperties props, ProviderCalls calls) {
        this.client = client;
        this.props = props;
        this.calls = calls;
    }

    // Checked at startup because the alternative is worse than it looks.
    // These two live here rather than in `WhatsAppClient` because they are this sender's concern.
    @PostConstruct
    void requireTemplate() {
        if (isBlank(props.otpTemplateName()) || isBlank(props.otpTemplateLang())) {
            throw new IllegalStateException(
                    "draazy.providers.whatsapp is enabled but otp-template-name/otp-template-lang "
                            + "are not set (WHATSAPP_OTP_TEMPLATE_NAME / WHATSAPP_OTP_TEMPLATE_LANG). "
                            + "They must name an AUTHENTICATION template already APPROVED on the "
                            + "WABA, with its full language AND locale code (en_US, not en). Meta "
                            + "forbids sending a one-time code as free-form text, so there is no "
                            + "templateless fallback.");
        }
    }

    // Send `code` to `mobile` as an authentication template.
    // The code appears twice in the payload, and both are required.
    @Override
    public void send(String mobile, String code) {
        sendTemplate(mobile, props.otpTemplateName(), props.otpTemplateLang(),
                List.of(code), true);
    }

    private void sendTemplate(String mobile, String templateName, String templateLang,
            List<String> bodyParams, boolean copyCodeButton) {
        List<Map<String, Object>> components = new ArrayList<>();
        components.add(Map.of("type", "body",
                "parameters", bodyParams.stream()
                        .map(value -> Map.of("type", "text", "text", value))
                        .toList()));
        if (copyCodeButton) {
            components.add(Map.of("type", "button",
                                        "sub_type", "url",
                                        "index", "0",
                    "parameters", List.of(Map.of("type", "text",
                            "text", bodyParams.getFirst()))));
        }
        Map<String, Object> payload = Map.of(
                "messaging_product", "whatsapp",
                "recipient_type", "individual",
                "to", COUNTRY_CODE + mobile,
                "type", "template",
                "template", Map.of(
                        "name", templateName,
                        "language", Map.of("code", templateLang),
                        "components", components));

        try {
            calls.track(ProviderCalls.WHATSAPP, OPERATION, mobile, null,
                    () -> client.post("/" + props.phoneNumberId() + "/messages", payload));
        } catch (WhatsAppClient.WhatsAppException e) {
            throw new DeliveryFailedException("WhatsApp could not deliver the code.", e);
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
