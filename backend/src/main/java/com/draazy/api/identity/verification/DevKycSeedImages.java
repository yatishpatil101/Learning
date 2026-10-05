package com.draazy.api.identity.verification;

import com.draazy.api.provider.FileStorage;
import com.draazy.api.security.LocalOnly;
import java.nio.charset.StandardCharsets;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;
import org.springframework.web.util.HtmlUtils;

@LocalOnly
@Component
class DevKycSeedImages {

    private final JdbcTemplate jdbc;
    private final FileStorage storage;

    DevKycSeedImages(JdbcTemplate jdbc, FileStorage storage) {
        this.jdbc = jdbc;
        this.storage = storage;
    }

    @EventListener(ApplicationReadyEvent.class)
    void paint() {
        jdbc.query("""
                SELECT f.storage_key, f.kind, v.doc_type, v.claimed_name, v.claimed_number_last4,
                       v.claimed_dob, v.liveness_challenge
                  FROM identity_verification_files f
                  JOIN identity_verifications v ON v.id = f.verification_id
                 WHERE f.storage_key LIKE 'dev-seed/kyc/%'
                """, (RowCallbackHandler) rs -> storage.store(rs.getString(1), svg(
                rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                rs.getString(6), rs.getString(7)).getBytes(StandardCharsets.UTF_8), "image/svg+xml"));
    }

    private static String svg(String kind, String docType, String name, String last4, String dob, String pose) {
        String body = "selfie".equals(kind)
                ? "<circle cx='300' cy='150' r='70' fill='#cbd5e1'/>"
                        + "<rect x='200' y='230' width='200' height='90' rx='45' fill='#cbd5e1'/>"
                        + text(170, 350, 20, "Selfie - pose: " + (pose == null ? "none" : pose))
                : text(40, 70, 26, docType.replace('_', ' ').toUpperCase() + " - " + kind)
                        + text(40, 150, 22, "Name: " + name)
                        + text(40, 195, 22, "Number: XXXX XXXX " + last4)
                        + text(40, 240, 22, "DOB: " + (dob == null ? "-" : dob));
        return "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='380' viewBox='0 0 600 380'>"
                + "<rect width='600' height='380' rx='18' fill='#f8fafc' stroke='#94a3b8' stroke-width='4'/>"
                + body + text(40, 372, 14, "DEV SEED - NOT A REAL DOCUMENT") + "</svg>";
    }

    private static String text(int x, int y, int size, String value) {
        return "<text x='" + x + "' y='" + y + "' font-family='sans-serif' font-size='" + size
                + "' fill='#0f172a'>" + HtmlUtils.htmlEscape(value) + "</text>";
    }
}
