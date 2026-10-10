package com.draazy.api.engagement.notification;

import com.draazy.api.common.trust.Notifier;
import com.draazy.api.provider.DecisionMessenger;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** At most one paid WhatsApp a day: only requests newer than the user's last app open and previous digest,
 * so each is announced once and never to someone who has seen it. */
@Service
public class WaitingDigestService {

    private static final Logger log = LoggerFactory.getLogger(WaitingDigestService.class);
    private static final Duration MIN_GAP = Duration.ofHours(20);

    private static final String CANDIDATES = """
            with waiting as (
                select p.owner_id as user_id, r.created_at
                  from contact_requests r join properties p on p.id = r.property_id
                 where r.status = 'pending' and p.status = 'approved' and not p.archived
                union all
                select p.owner_id, r.created_at
                  from document_requests r join properties p on p.id = r.property_id
                 where r.status = 'pending' and p.status = 'approved' and not p.archived
                union all
                select p.owner_id, r.created_at
                  from offers r join properties p on p.id = r.property_id
                 where r.status = 'pending' and p.status = 'approved' and not p.archived
                union all
                select p.owner_id, r.created_at
                  from visits r join properties p on p.id = r.property_id
                 where r.status = 'scheduled' and r.slot > ? and p.status = 'approved' and not p.archived
            )
            select u.id, u.mobile, u.waiting_digest_at as previous, count(*) as waiting
              from waiting w join users u on u.id = w.user_id
             where u.status = 'active' and not u.archived
               and w.created_at > coalesce(u.last_active, '-infinity'::timestamptz)
               and w.created_at > coalesce(u.waiting_digest_at, '-infinity'::timestamptz)
             group by u.id, u.mobile, u.waiting_digest_at
            """;

    private final JdbcTemplate jdbc;
    private final Notifier notifier;
    private final DecisionMessenger messenger;

    public WaitingDigestService(JdbcTemplate jdbc, Notifier notifier, DecisionMessenger messenger) {
        this.jdbc = jdbc;
        this.notifier = notifier;
        this.messenger = messenger;
    }

    public int sendDue(Instant now) {
        Timestamp at = Timestamp.from(now);
        List<Candidate> candidates = jdbc.query(CANDIDATES,
                (rs, row) -> new Candidate(rs.getObject("id", UUID.class), rs.getString("mobile"),
                        rs.getInt("waiting"), rs.getTimestamp("previous")),
                at);
        int sent = 0;
        for (Candidate candidate : candidates) {
            try {
                if (!notifier.allowsWhatsapp(candidate.userId()) || !claim(candidate.userId(), now)) {
                    continue;
                }
                if (messenger.sendWaitingDigest(candidate.mobile(), describe(candidate.waiting()))) {
                    sent++;
                } else {
                    release(candidate, now);
                }
            } catch (RuntimeException e) {
                release(candidate, now);
                log.warn("Waiting digest failed for user {}", candidate.userId(), e);
            }
        }
        return sent;
    }

    // A send that did not go out must not swallow the requests it was meant to announce.
    private void release(Candidate candidate, Instant now) {
        jdbc.update("update users set waiting_digest_at = ? where id = ? and waiting_digest_at = ?",
                candidate.previous(), candidate.userId(), Timestamp.from(now));
    }

    // The conditional update is the once-a-day guard even with several instances ticking at once.
    private boolean claim(UUID userId, Instant now) {
        return jdbc.update("""
                update users set waiting_digest_at = ?
                 where id = ? and (waiting_digest_at is null or waiting_digest_at <= ?)
                """, Timestamp.from(now), userId, Timestamp.from(now.minus(MIN_GAP))) == 1;
    }

    static String describe(int waiting) {
        return waiting == 1 ? "1 request" : waiting + " requests";
    }

    record Candidate(UUID userId, String mobile, int waiting, Timestamp previous) {
    }
}
