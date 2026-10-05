package com.draazy.api.engagement.helpfeedback;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.identity.auth.Tokens;
import com.draazy.api.security.AuthPrincipal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The only writer of {@link HelpFeedback}. */
@Service
public class HelpFeedbackService {

    static final int DAILY_IP_SLUG_LIMIT = 20;

    /** Wider than {@code \p{Cntrl}}, which in Java is ASCII only. U+0085, U+2028 and U+2029 break a
     * CSV row and a log line exactly as a bare {@code \r} does, and arrive readily from a paste. */
    private static final Pattern CONTROL_CHARS =
            Pattern.compile("[\\p{Cntrl}\\u0080-\\u009F\\u0085\\u2028\\u2029&&[^\t\n]]");

    private final HelpFeedbackRepository repository;

    public HelpFeedbackService(HelpFeedbackRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public void record(HelpFeedbackCreate body, AuthPrincipal principal, String remoteAddress) {
        String ipHash = hashIp(remoteAddress);
        Instant dayStart = LocalDate.now(PlatformTime.IST)
                .atStartOfDay(PlatformTime.IST)
                .toInstant();
        if (repository.countBySlugAndIpHashAndCreatedAtAfter(
                body.slug(), ipHash, dayStart) >= DAILY_IP_SLUG_LIMIT) {
            return;
        }
        HelpFeedback row = new HelpFeedback();
        row.setSlug(body.slug());
        row.setLang(body.lang());
        row.setHelpful(body.helpful());
        row.setComment(blankToNull(body.comment()));
        row.setUserId(principal == null ? null : principal.userId());
        row.setIpHash(ipHash);
        repository.save(row);
    }

    /** Only strip controls; escaping belongs to the read path that knows its output format. */
    private static String blankToNull(String raw) {
        if (raw == null) {
            return null;
        }
        String trimmed = CONTROL_CHARS.matcher(raw).replaceAll("").trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    static String hashIp(String remoteAddress) {
        return Tokens.sha256Hex("help-feedback:" + (remoteAddress == null ? "" : remoteAddress));
    }
}
