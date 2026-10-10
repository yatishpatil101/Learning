package com.draazy.api.admin;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.web.PageResponse;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** The reader of {@code help_article_feedback}, which {@code HelpFeedbackService} only writes. */
@Service
public class AdminHelpFeedbackService {

    private static final Pattern SLUG = Pattern.compile("[a-z0-9-]{1,120}");
    private static final int MAX_PAGE = 100;
    private static final int MIN_VOTES = 5;

    private final JdbcTemplate jdbc;

    public AdminHelpFeedbackService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Worst "not helpful" share first among articles with {@code MIN_VOTES}+ verdicts, so one early thumbs-down
     * does not top the list; per language, so a weak translation is not averaged away. */
    public PageResponse<AdminHelpFeedbackArticle> articles(int page, int size) {
        int safeSize = Math.clamp(size, 1, MAX_PAGE);
        int safePage = Math.max(page, 0);
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM (SELECT 1 FROM help_article_feedback GROUP BY slug, lang) g", Long.class);
        List<AdminHelpFeedbackArticle> rows = jdbc.query("""
                SELECT slug, lang,
                       count(*) FILTER (WHERE helpful),
                       count(*) FILTER (WHERE NOT helpful),
                       count(comment),
                       max(created_at)
                FROM help_article_feedback
                GROUP BY slug, lang
                ORDER BY (count(*) >= ?) DESC,
                         count(*) FILTER (WHERE NOT helpful)::numeric / count(*) DESC,
                         count(*) DESC, slug, lang
                LIMIT ? OFFSET ?""",
                (rs, n) -> new AdminHelpFeedbackArticle(rs.getString(1), rs.getString(2),
                        rs.getLong(3), rs.getLong(4), rs.getLong(5), instant(rs, 6)),
                MIN_VOTES, safeSize, (long) safePage * safeSize);
        return page(rows, safePage, safeSize, total);
    }

    public PageResponse<AdminHelpFeedbackComment> comments(String slug, int page, int size) {
        if (slug != null && !SLUG.matcher(slug).matches()) {
            throw new BadRequestException("slug must be lower-case letters, digits and hyphens");
        }
        int safeSize = Math.clamp(size, 1, MAX_PAGE);
        int safePage = Math.max(page, 0);
        String where = slug == null ? "" : " AND slug = ?";
        Object[] filter = slug == null ? new Object[0] : new Object[] {slug};
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM help_article_feedback WHERE comment IS NOT NULL" + where, Long.class, filter);
        Object[] args = Arrays.copyOf(filter, filter.length + 2);
        args[filter.length] = safeSize;
        args[filter.length + 1] = (long) safePage * safeSize;
        List<AdminHelpFeedbackComment> rows = jdbc.query(
                "SELECT id, slug, lang, helpful, comment, created_at FROM help_article_feedback"
                        + " WHERE comment IS NOT NULL" + where + " ORDER BY created_at DESC, id LIMIT ? OFFSET ?",
                (rs, n) -> new AdminHelpFeedbackComment(rs.getObject(1, UUID.class), rs.getString(2),
                        rs.getString(3), rs.getBoolean(4), rs.getString(5), instant(rs, 6)),
                args);
        return page(rows, safePage, safeSize, total);
    }

    private static <T> PageResponse<T> page(List<T> rows, int page, int size, Long total) {
        return PageResponse.of(new PageImpl<>(rows, PageRequest.of(page, size), total == null ? 0 : total),
                Function.identity());
    }

    private static Instant instant(ResultSet rs, int column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
