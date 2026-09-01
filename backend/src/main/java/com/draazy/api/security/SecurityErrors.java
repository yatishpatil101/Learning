package com.draazy.api.security;

import com.draazy.api.common.web.RequestCorrelation;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.MDC;
import org.springframework.http.MediaType;

/**
 * Writes the contract error envelope from inside the security filter chain, where the
 * {@code @RestControllerAdvice} can't reach (auth failures short-circuit before the controller).
 * Keeps the 401/403 bodies byte-identical to the ones the advice emits.
 *
 * <p>The envelope is hand-serialized rather than pulling in Jackson: the payload is three fixed
 * fields plus an optional trace id, so a tiny writer is lighter than a databind dependency.
 */
final class SecurityErrors {

    private SecurityErrors() {
    }

    static void write(HttpServletResponse response, int status, String code, String message)
            throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        String traceId = MDC.get(RequestCorrelation.TRACE_ID_MDC);
        StringBuilder json = new StringBuilder()
                .append("{\"error\":\"").append(escape(code))
                .append("\",\"message\":\"").append(escape(message))
                .append("\",\"status\":").append(status);
        if (traceId != null) {
            json.append(",\"traceId\":\"").append(escape(traceId)).append('"');
        }
        json.append('}');
        response.getWriter().write(json.toString());
    }

    private static String escape(String s) {
        // RFC 8259 minimal escaping: backslash, quote, and the control chars that would otherwise
        // produce invalid JSON (or a header/log-injection vector) if they leaked into a message.
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t")
                .replace("\b", "\\b")
                .replace("\f", "\\f");
    }
}
