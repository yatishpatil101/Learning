package com.draazy.api.admin;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.provider.ProviderCalls;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AdminIntegrationsService {

    private static final List<String> PROVIDERS =
            List.of(ProviderCalls.ZEPTOMAIL, ProviderCalls.WHATSAPP, ProviderCalls.CASHFREE);
    private static final List<String> OUTCOMES = Arrays.stream(ProviderCalls.Outcome.values())
            .map(ProviderCalls.Outcome::wire).toList();
    private static final int MAX_PAGE = 100;
    private static final long MAX_OFFSET = 100_000L;

    private final JdbcTemplate jdbc;
    private final Map<String, Boolean> live;

    public AdminIntegrationsService(JdbcTemplate jdbc,
            @Value("${draazy.providers.zeptomail.enabled:false}") boolean emailLive,
            @Value("${draazy.providers.whatsapp.enabled:false}") boolean whatsAppLive,
            @Value("${draazy.providers.cashfree.enabled:false}") boolean cashfreeLive) {
        this.jdbc = jdbc;
        this.live = Map.of(ProviderCalls.ZEPTOMAIL, emailLive,
                ProviderCalls.WHATSAPP, whatsAppLive,
                ProviderCalls.CASHFREE, cashfreeLive);
    }

    public List<AdminProviderHealth> health() {
        Map<String, AdminProviderHealth> found = new HashMap<>();
        Map<String, String> lastFailure = new HashMap<>();
        jdbc.query("""
                SELECT DISTINCT ON (provider) provider, detail FROM provider_call
                WHERE outcome = 'failed' ORDER BY provider, created_at DESC""",
                (ResultSet rs) -> {
                    lastFailure.put(rs.getString(1), rs.getString(2));
                });
        jdbc.query("""
                SELECT provider,
                       count(*) FILTER (WHERE outcome = 'ok'      AND created_at > now() - interval '1 day'),
                       count(*) FILTER (WHERE outcome = 'failed'  AND created_at > now() - interval '1 day'),
                       count(*) FILTER (WHERE outcome = 'skipped' AND created_at > now() - interval '1 day'),
                       count(*) FILTER (WHERE outcome = 'ok'      AND created_at > now() - interval '7 days'),
                       count(*) FILTER (WHERE outcome = 'failed'  AND created_at > now() - interval '7 days'),
                       max(created_at) FILTER (WHERE outcome = 'ok'),
                       max(created_at) FILTER (WHERE outcome = 'failed')
                FROM provider_call GROUP BY provider""",
                (ResultSet rs) -> {
                    String provider = rs.getString(1);
                    found.put(provider, new AdminProviderHealth(provider, live.getOrDefault(provider, false),
                            rs.getLong(2), rs.getLong(3), rs.getLong(4), rs.getLong(5), rs.getLong(6),
                            instant(rs, 7), instant(rs, 8), lastFailure.get(provider)));
                });
        return PROVIDERS.stream()
                .map(p -> found.getOrDefault(p, new AdminProviderHealth(p, live.get(p),
                        0, 0, 0, 0, 0, null, null, null)))
                .toList();
    }

    public PageResponse<AdminProviderCall> calls(String provider, String outcome, String q, int page, int size) {
        if (provider != null && !PROVIDERS.contains(provider)) {
            throw new BadRequestException("provider must be one of " + PROVIDERS);
        }
        if (outcome != null && !OUTCOMES.contains(outcome)) {
            throw new BadRequestException("outcome must be one of " + OUTCOMES);
        }
        int safeSize = Math.clamp(size, 1, MAX_PAGE);
        int safePage = Math.max(page, 0);
        long offset = (long) safePage * safeSize;
        if (offset > MAX_OFFSET) {
            throw new BadRequestException("page is beyond the log; at most " + MAX_OFFSET + " rows may be skipped");
        }

        StringBuilder where = new StringBuilder(" WHERE true");
        List<Object> args = new ArrayList<>();
        if (provider != null) {
            where.append(" AND provider = ?");
            args.add(provider);
        }
        if (outcome != null) {
            where.append(" AND outcome = ?");
            args.add(outcome);
        }
        if (q != null && !q.isBlank()) {
            // A recipient is only ever found by its full address; the stored form is masked.
            String hash = ProviderCalls.hashRecipient(q);
            where.append(" AND (reference = ?").append(hash == null ? ")" : " OR recipient_hash = ?)");
            args.add(q.strip());
            if (hash != null) {
                args.add(hash);
            }
        }

        Long total = jdbc.queryForObject("SELECT count(*) FROM provider_call" + where, Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(safeSize);
        pageArgs.add(offset);
        List<AdminProviderCall> rows = jdbc.query("""
                SELECT id, provider, operation, outcome, recipient, reference, detail, duration_ms, created_at
                FROM provider_call""" + where + " ORDER BY created_at DESC, id LIMIT ? OFFSET ?",
                (rs, n) -> new AdminProviderCall(
                        rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getString(6), rs.getString(7),
                        rs.getObject(8, Integer.class), instant(rs, 9)),
                pageArgs.toArray());
        return PageResponse.of(
                new PageImpl<>(rows, PageRequest.of(safePage, safeSize, Sort.by(Sort.Order.desc("createdAt"))),
                        total == null ? 0 : total),
                Function.identity());
    }

    private static Instant instant(ResultSet rs, int column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
