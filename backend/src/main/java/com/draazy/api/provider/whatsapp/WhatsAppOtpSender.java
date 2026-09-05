package com.draazy.api.provider.whatsapp;

import com.draazy.api.provider.OtpSender;
import jakarta.annotation.PostConstruct;
import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Delivers login codes as a WhatsApp {@code AUTHENTICATION} template through the Meta Cloud API
 * (ADR-020).
 *
 * <p><strong>Why a template and not a text message.</strong> Meta will not carry a business-initiated
 * free-form message at all outside an open 24-hour customer-service window, and a login code by
 * definition arrives before any conversation exists. The {@code AUTHENTICATION} category is the only
 * one that may carry a one-time code, its body text is fixed boilerplate we cannot author, and it
 * must be approved against our WhatsApp Business Account before the first send. So the template name
 * and language are configuration, not literals: they name a record that lives in Meta's dashboard.
 *
 * <p><strong>Not profile-bound.</strong> Unlike the dev mock and the unconfigured stub this bean is
 * selected purely by {@code draazy.providers.whatsapp.enabled}, because Meta's only sandbox is a
 * free test number on a live host — there is no second endpoint to point a "test" profile at. A
 * developer with test-number credentials runs this exact class under {@code dev}, which is the point:
 * the thing that gets exercised locally is the thing that ships.
 */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.whatsapp", name = "enabled", havingValue = "true")
class WhatsAppOtpSender implements OtpSender {

    /**
     * India's calling code, prefixed to the stored mobile to reach E.164.
     *
     * <p>Hardcoded rather than configured because it is not free to vary: {@code MobileMask.normalise}
     * — which every caller of this seam has already run — accepts <em>only</em> a ten-digit Indian
     * mobile and returns {@code null} for anything else. A configurable country code here would let a
     * deployment claim to serve a country whose numbers the validator upstream rejects, which is a
     * setting that can only ever be wrong. Widening the platform means changing the validator first,
     * and this constant will be sitting next to it in the grep.
     */
    private static final String COUNTRY_CODE = "91";

    private final WhatsAppClient client;
    private final WhatsAppProperties props;

    WhatsAppOtpSender(WhatsAppClient client, WhatsAppProperties props) {
        this.client = client;
        this.props = props;
    }

    /**
     * Refuse to finish booting without a template to send.
     *
     * <p>These two live here rather than in {@link WhatsAppClient} because they are this sender's
     * concern, not the shared door's — the notification providers of ADR-010 will name different
     * templates through the same client.
     *
     * <p>Checked at startup because the alternative is worse than it looks. A blank name does not
     * throw on the way out; it posts {@code "name": ""} and Meta answers 400, so an unset variable
     * surfaces as a 500 on <em>every login for everybody</em>, with a vendor error code as the only
     * clue. The same reasoning as {@code OtpService.rejectFixedCodeInProduction}: a configuration
     * mistake made somewhere other than the file being read should kill the process, not the
     * product.
     */
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

    /**
     * Send {@code code} to {@code mobile} as an authentication template.
     *
     * <p><strong>The code appears twice in the payload, and both are required.</strong> Once as the
     * body parameter, which is the text the user reads, and once as the copy-code button's parameter,
     * which is what the button places on the clipboard. Meta rejects the message if the button
     * component is missing, and a template approved with a copy-code button addresses that button as
     * {@code sub_type: "url"} at {@code index: "0"} — a naming quirk of the API, not a URL.
     *
     * <p><strong>Failures are reported as {@link DeliveryFailedException}, which spends the
     * recipient's send budget.</strong> That is the claim the seam attaches to this type, and it is
     * the right one here: a request that reached Meta and then timed out is indistinguishable from
     * one Meta refused, and the message may well have gone out. Charging the slot is the only safe
     * direction — the alternative rolls the OTP row back and hands out a free "ring this number".
     * The failure still propagates to the caller, so the user gets an error and can retry rather
     * than a silent success and a code that never arrives.
     *
     * <p>Only a {@link WhatsAppClient.WhatsAppException} is converted. Anything else escaping this
     * method is a bug in this class, not a delivery attempt, and must be left to roll back.
     */
    @Override
    public void send(String mobile, String code) {
        Map<String, Object> payload = Map.of(
                "messaging_product", "whatsapp",
                "recipient_type", "individual",
                "to", COUNTRY_CODE + mobile,
                "type", "template",
                "template", Map.of(
                        "name", props.otpTemplateName(),
                        "language", Map.of("code", props.otpTemplateLang()),
                        "components", List.of(
                                Map.of("type", "body",
                                        "parameters", List.of(Map.of("type", "text", "text", code))),
                                Map.of("type", "button",
                                        "sub_type", "url",
                                        "index", "0",
                                        "parameters", List.of(Map.of("type", "text", "text", code))))));

        try {
            client.post("/" + props.phoneNumberId() + "/messages", payload);
        } catch (WhatsAppClient.WhatsAppException e) {
            // Meta's own wording is not repeated into ours: it is vendor free text that can name the
            // recipient in full, and the client has already logged the redacted form.
            throw new DeliveryFailedException("WhatsApp could not deliver the code.", e);
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
