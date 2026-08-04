package com.punenest.api.admin;

import java.util.Map;

/**
 * The platform settings document and the entity tag that describes <em>it</em> (tech debt D66).
 *
 * <p><strong>Why they travel together.</strong> The obvious shape was two service calls — one for
 * the body, one for the tag — and it is quietly wrong. Each would run in its own transaction, so a
 * write landing between them would hand the caller a tag belonging to a document they were never
 * shown. On the {@code PUT} path that fails in the dangerous direction: the caller's next
 * conditional write passes a precondition it had no right to pass, and silently overwrites the edit
 * the tag actually described. Pairing them in one return value makes that mistake unavailable rather
 * than merely discouraged.
 *
 * @param body  the folded document, exactly as the contract's {@code AdminSettings} is serialised
 * @param etag  a strong entity tag, quoted and ready to be written straight to the header
 */
public record SettingsDocument(Map<String, Object> body, String etag) {
}
