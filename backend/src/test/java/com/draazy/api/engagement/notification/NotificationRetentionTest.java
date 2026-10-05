package com.draazy.api.engagement.notification;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("Notification retention")
class NotificationRetentionTest extends AbstractApiTest {

    @Autowired NotificationRetention retention;
    @Autowired UserRepository users;

    @Test
    void purgesOnlyRowsPastTheWindow() {
        User u = user("9800000451");
        Instant now = Instant.now();
        Instant cutoff = now.minus(NotificationRetention.RETENTION);

        note(u, "old", cutoff.minus(Duration.ofDays(1)));
        note(u, "edge", cutoff.plusSeconds(60));
        note(u, "new", now.minus(Duration.ofDays(1)));

        assertThat(retention.purgeOlderThan(cutoff)).isEqualTo(1);
        assertThat(titles(u)).containsExactlyInAnyOrder("edge", "new");
    }

    @Test
    void emptyPurgeIsANoop() {
        User u = user("9800000452");
        note(u, "new", Instant.now());

        assertThat(retention.purgeOlderThan(Instant.now().minus(NotificationRetention.RETENTION)))
                .isZero();
        assertThat(titles(u)).containsExactly("new");
    }

    private User user(String mobile) {
        User u = new User(mobile, "buyer");
        u.setName("Retention " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private void note(User user, String title, Instant at) {
        jdbc.update("""
                insert into notifications (user_id, type, title, created_at)
                values (?, 'info', ?, ?)
                """, user.getId(), title, Timestamp.from(at));
    }

    private List<String> titles(User user) {
        return jdbc.queryForList("""
                select title from notifications
                 where user_id = ? and title in ('old', 'edge', 'new')
                 order by title
                """, String.class, user.getId());
    }
}
