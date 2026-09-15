package com.draazy.api.provider.whatsapp;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Meta WhatsApp Cloud API credentials and the on/off flag for every WhatsApp-backed provider.
 * {@code enabled} binds the key but must not gate behaviour; docs/system/profiles.md#vendor-flags.
 */
@ConfigurationProperties("draazy.providers.whatsapp")
public record WhatsAppProperties(
        boolean enabled,
        String baseUrl,
        String apiVersion,
        String phoneNumberId,
        String accessToken,
        String otpTemplateName,
        String otpTemplateLang,
        String identityTemplateName,
        String identityTemplateLang) {

    /**
     * Redacts {@link #accessToken}, because the synthesized {@code toString()} would print it
     * wherever a record is interpolated by accident, and a logged bearer token must be rotated.
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
                + ", otpTemplateLang=" + otpTemplateLang
                + ", identityTemplateName=" + identityTemplateName
                + ", identityTemplateLang=" + identityTemplateLang + "]";
    }
}
