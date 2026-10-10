package com.draazy.api.provider.push;

import org.springframework.boot.context.properties.ConfigurationProperties;

// VAPID key pair for Web Push, as base64url strings (public: 65-byte uncompressed point, private: 32-byte scalar).
// Both blank selects the logging sender.
@ConfigurationProperties("draazy.providers.push")
public record PushProperties(String vapidPublicKey, String vapidPrivateKey, String subject) {

    // Redact the private key; accidental logging would require rotation.
    @Override
    public String toString() {
        return "PushProperties[vapidPublicKey=" + vapidPublicKey
                + ", vapidPrivateKey=" + (vapidPrivateKey == null || vapidPrivateKey.isBlank()
                        ? "unset" : "<redacted>")
                + ", subject=" + subject + "]";
    }
}
