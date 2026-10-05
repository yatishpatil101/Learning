package com.draazy.api.provider.whatsapp;

import org.springframework.boot.context.properties.ConfigurationProperties;

// Meta WhatsApp Cloud API credentials and the on/off flag for every WhatsApp-backed provider.
// `enabled` binds the key but must not gate behaviour; docs/system/profiles.md#vendor-flags.
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

    // Redact the bearer token; accidental logging would require rotation.
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
