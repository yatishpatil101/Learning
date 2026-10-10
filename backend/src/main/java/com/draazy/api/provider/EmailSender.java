package com.draazy.api.provider;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Transactional email (ADR-010). Best-effort and never throws: every caller has another path to the user. */
public interface EmailSender {

    String OPERATION = "email";

    void send(String to, String subject, String text);

    /** Domain only: the local part is PII and the address is all a log reader needs to triage. */
    static String maskAddress(String address) {
        int at = address == null ? -1 : address.indexOf('@');
        return at < 0 ? "<invalid>" : "***" + address.substring(at);
    }
}

/** The body is never logged: it can carry a single-use credential such as a staff invite link. */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.zeptomail", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class LoggingEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(LoggingEmailSender.class);

    private final ProviderCalls calls;

    LoggingEmailSender(ProviderCalls calls) {
        this.calls = calls;
    }

    @Override
    public void send(String to, String subject, String text) {
        log.info("[MOCK EMAIL] to={} subject={}", EmailSender.maskAddress(to), subject);
        calls.record(ProviderCalls.ZEPTOMAIL, OPERATION, ProviderCalls.Outcome.SKIPPED, to, subject, "mock", null);
    }
}
