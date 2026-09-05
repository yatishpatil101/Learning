package com.draazy.api.provider.whatsapp;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Meta WhatsApp Cloud API credentials and the master on/off switch for every WhatsApp-backed
 * provider (login OTP today, ADR-010 notification templates later).
 *
 * <p><strong>A flag, not the {@code prod} profile</strong>, for the reason spelled out on
 * {@code CashfreeProperties}: "which environment is this" and "do we hold vendor credentials" are
 * independent questions. Here the split matters more than it does for Cashfree, because Meta's
 * <em>only</em> sandbox is a free test number attached to a real app — there is no separate sandbox
 * host, and the same code path serves both. A developer holding test-number credentials must be
 * able to send a genuine WhatsApp message from the {@code dev} profile, and a deployment must be
 * able to fall back to no sender at all, without either pretending to be the other.
 *
 * <p>Default is <strong>off</strong>. A missing configuration value should land on the behaviour
 * that cannot cost money or message a stranger's phone.
 *
 * <p><strong>{@link #enabled} is bound here but must not be read to decide behaviour.</strong> Bean
 * selection is done by {@code @ConditionalOnProperty}, which compares the raw string to
 * {@code "true"}; this field is bound by Spring's relaxed converter, which also accepts {@code on},
 * {@code yes} and {@code 1}. The two vocabularies disagree, so an {@code if (props.enabled())}
 * anywhere would eventually contradict the wiring. Depend on which bean exists, not on this value.
 *
 * @param enabled          see the caveat above — present so the key binds, not as a runtime switch
 * @param baseUrl          Graph API host. There is no test host; the test number differs only by
 *                         which {@code phoneNumberId} you hold
 * @param apiVersion       pinned Graph API version, e.g. {@code v23.0}. Meta deprecates versions on
 *                         a rolling ~2-year clock, so this is an explicit, greppable value rather
 *                         than an implicit "latest" that changes underneath a running deployment
 * @param phoneNumberId    the <em>numeric ID</em> of the sending number, not the number itself. The
 *                         test number and the production number are two different IDs against the
 *                         same code
 * @param accessToken      bearer token for the Graph API. Must be a <strong>System User</strong>
 *                         token: the one the App Dashboard hands out on the WhatsApp setup page
 *                         expires in 24 hours, which fails as "logins stopped working overnight"
 * @param otpTemplateName  name of the approved {@code AUTHENTICATION} template. Meta will not let
 *                         an OTP go out as free-form text, so this is required, not cosmetic
 * @param otpTemplateLang  the template's language <em>and locale</em> code, e.g. {@code en_US}. A
 *                         template approved as {@code en_US} does not answer to {@code en}
 */
@ConfigurationProperties("draazy.providers.whatsapp")
public record WhatsAppProperties(
        boolean enabled,
        String baseUrl,
        String apiVersion,
        String phoneNumberId,
        String accessToken,
        String otpTemplateName,
        String otpTemplateLang) {

    /**
     * Redacts {@link #accessToken}, overriding the record's synthesized {@code toString()}.
     *
     * <p>Nothing prints this today. The override exists because the default would, and the places
     * that would do it are the ones nobody writes deliberately: a {@code log.debug("{}", props)}
     * added while chasing an unrelated bug, an exception message that interpolates the record, or
     * Spring's own binding-failure diagnostics. A bearer token in a log file is a token that has to
     * be rotated, and the log will have been shipped somewhere before anyone notices.
     */
    @Override
    public String toString() {
        return "WhatsAppProperties[enabled=" + enabled
                + ", baseUrl=" + baseUrl
                + ", apiVersion=" + apiVersion
                + ", phoneNumberId=" + phoneNumberId
                + ", accessToken=" + (accessToken == null || accessToken.isBlank()
                        ? "unset" : "<redacted>")
                + ", otpTemplateName=" + otpTemplateName
                + ", otpTemplateLang=" + otpTemplateLang + "]";
    }
}
