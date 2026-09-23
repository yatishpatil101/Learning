package com.draazy.api.engagement.helpfeedback;

import com.draazy.api.security.AuthPrincipal;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The only writer of {@link HelpFeedback}.
 *
 * <p>No dedupe and no per-reader ceiling of its own: volume is bounded by
 * {@code WriteRateLimitFilter}, which caps mutating requests per caller and already covers this
 * route.
 */
@Service
public class HelpFeedbackService {

    /**
     * Wider than {@code \p{Cntrl}}, which in Java is ASCII only. U+0085, U+2028 and U+2029 break a
     * CSV row and a log line exactly as a bare {@code \r} does, and arrive readily from a paste.
     */
    private static final Pattern CONTROL_CHARS =
            Pattern.compile("[\\p{Cntrl}\\u0080-\\u009F\\u0085\\u2028\\u2029&&[^\t\n]]");

    private final HelpFeedbackRepository repository;

    public HelpFeedbackService(HelpFeedbackRepository repository) {
        this.repository = repository;
    }

    /**
     * Record one verdict. {@code principal} is null for signed-out readers, which is the common
     * case: the help centre is what people read before they have an account.
     */
    @Transactional
    public void record(HelpFeedbackCreate body, AuthPrincipal principal) {
        HelpFeedback row = new HelpFeedback();
        row.setSlug(body.slug());
        row.setLang(body.lang());
        row.setHelpful(body.helpful());
        row.setComment(blankToNull(body.comment()));
        row.setUserId(principal == null ? null : principal.userId());
        repository.save(row);
    }

    /**
     * Trim to null, dropping control characters.
     *
     * <p>The stripping is the only thing done to a reader's prose, deliberately: escaping is the
     * read path's to do — it knows whether it is producing a web page, a spreadsheet or an email,
     * and the obligation is recorded on the {@code comment} column. Control characters are the
     * exception because they carry no meaning to strip and cannot be fixed downstream: a NUL byte or
     * a lone {@code \u001b} corrupts a log line, a terminal and a CSV alike.
     */
    private static String blankToNull(String raw) {
        if (raw == null) {
            return null;
        }
        String trimmed = CONTROL_CHARS.matcher(raw).replaceAll("").trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
