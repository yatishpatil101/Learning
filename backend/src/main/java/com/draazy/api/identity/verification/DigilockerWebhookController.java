package com.draazy.api.identity.verification;

import tools.jackson.databind.ObjectMapper;
import com.draazy.api.common.web.Routes;
import com.draazy.api.provider.cashfree.WebhookSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Cashfree/DigiLocker verification callback at {@code /webhooks/cashfree/digilocker} — the only
 * unauthenticated write in the application.
 *
 * <p><strong>Three rules, all of them load-bearing.</strong>
 *
 * <ol>
 *   <li><em>Signature-verified.</em> The route is {@code permitAll} because a provider has no user
 *       session; authenticity comes from an HMAC over the raw body ({@link WebhookSignature}). Without
 *       it, anyone who learned the URL could grant themselves a Verified badge.</li>
 *   <li><em>Raw body, not a bound object.</em> The body arrives as a {@code String} and is parsed
 *       here, because the signature covers the exact bytes sent. Letting Spring bind a
 *       {@link DigilockerWebhook} first and re-serializing it would change key order and whitespace,
 *       and every genuine callback would fail verification.</li>
 *   <li><em>Always {@code 200}.</em> A forged signature, malformed JSON and an unknown {@code ref} all
 *       return the same empty {@code 200} as a success. Two reasons: a provider that sees an error
 *       retries forever, and a differentiated response would let a prober confirm whether a signature
 *       or a {@code ref} was valid. Processing is skipped; only the status code is uniform.</li>
 * </ol>
 *
 * <p>Nothing about the payload is logged beyond the correlation {@code ref} — the callback carries
 * identity data, and a log line is a copy of it in a place with different access controls.
 */
@RestController
public class DigilockerWebhookController {

    private static final Logger log = LoggerFactory.getLogger(DigilockerWebhookController.class);

    private final VerificationService verificationService;
    private final WebhookSignature webhookSignature;
    private final ObjectMapper objectMapper;

    public DigilockerWebhookController(VerificationService verificationService,
            WebhookSignature webhookSignature, ObjectMapper objectMapper) {
        this.verificationService = verificationService;
        this.webhookSignature = webhookSignature;
        this.objectMapper = objectMapper;
    }

    /**
     * {@code POST /webhooks/cashfree/digilocker} (contract {@code cashfreeDigilockerWebhook}).
     *
     * @param signature {@code x-webhook-signature}, base64 HMAC-SHA256 over {@code timestamp + body}
     * @param timestamp {@code x-webhook-timestamp}, signed alongside the body so a capture cannot be
     *                  replayed under a new time
     * @param rawBody   the exact bytes signed
     */
    @PostMapping(Routes.Webhooks.CASHFREE_DIGILOCKER)
    @ResponseStatus(HttpStatus.OK)
    public void cashfreeDigilockerWebhook(
            @RequestHeader(name = "x-webhook-signature", required = false) String signature,
            @RequestHeader(name = "x-webhook-timestamp", required = false) String timestamp,
            @RequestBody(required = false) String rawBody) {

        if (!webhookSignature.matches(signature, timestamp, rawBody)) {
            log.warn("Rejected DigiLocker webhook: signature did not verify");
            return;
        }
        try {
            DigilockerWebhook payload = objectMapper.readValue(rawBody, DigilockerWebhook.class);
            verificationService.handleWebhook(payload);
        } catch (Exception unprocessable) {
            // why: a signed-but-unreadable payload is our bug or a provider change, not the sender's
            // problem - retrying it will not help, so we swallow it and keep the 200 contract.
            log.error("Signed DigiLocker webhook could not be processed", unprocessable);
        }
    }
}
