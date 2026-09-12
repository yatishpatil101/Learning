package com.draazy.api.engagement.pageview;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.support.AbstractApiTest;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The ninety-day promise on raw page views, exercised at a cutoff the test chooses.
 *
 * <p>Retention is a claim made to data subjects, not a housekeeping detail: {@code page_views}
 * carries a session id and sometimes a user id, and the reason keeping it is defensible at all is
 * that it does not accumulate indefinitely. A sweep that silently deletes nothing is the failure
 * mode with no symptom — the console keeps working, because it reads the aggregates.
 *
 * <p>Rolls back with {@code AbstractApiTest}'s transaction, so {@code draazy_test} stays empty.
 *
 * <p>Erasure is <em>not</em> tested here. Nulling {@code user_id} is proved end to end by
 * {@code ErasureCoverageTest}, which reads the rows back instead of trusting the reported count —
 * a distinction that matters, because a sweep neutered to {@code set user_id = user_id} still
 * reports the same number of rows updated.
 */
@DisplayName("Page view retention")
class PageViewRetentionTest extends AbstractApiTest {

    @Autowired PageViewRetention retention;

    @Test
    @DisplayName("deletes views past the window and keeps everything inside it")
    void expiresOnlyWhatIsPastTheWindow() {
        Instant now = Instant.now();
        Instant cutoff = now.minus(PageViewRetention.RETENTION);

        // Asserted against the real constant rather than a literal 90 retyped here: a test that
        // hard-codes the window goes on passing after somebody changes the policy, which makes it
        // worse than no test at all.
        view("sess-old", cutoff.minus(Duration.ofDays(1)));
        view("sess-edge", cutoff.plusSeconds(60));
        view("sess-new", now.minus(Duration.ofDays(1)));

        int removed = retention.expirePageViewsOlderThan(cutoff);

        assertThat(removed).isEqualTo(1);
        assertThat(sessionsLeft())
                .as("the row a minute inside the window must survive; an off-by-one on the "
                        + "comparison would silently shorten the retention promise by a day")
                .containsExactlyInAnyOrder("sess-edge", "sess-new");
    }

    @Test
    @DisplayName("an empty sweep is a no-op rather than a failure")
    void sweepingWithNothingToDoRemovesNothing() {
        view("sess-new", Instant.now());

        // The scheduled sweep runs daily and will find nothing on most of them. Returning zero is
        // the expected steady state, not an error condition to log about.
        assertThat(retention.expirePageViewsOlderThan(
                Instant.now().minus(PageViewRetention.RETENTION)))
                .isZero();
        assertThat(sessionsLeft()).containsExactly("sess-new");
    }

    private java.util.List<String> sessionsLeft() {
        return jdbc.queryForList(
                "select session_id from page_views where session_id like 'sess-%'", String.class);
    }

    private void view(String sessionId, Instant at) {
        jdbc.update("""
                insert into page_views (session_id, path, device, occurred_at)
                values (?, '/listings', 'mobile', ?)
                """, sessionId, java.sql.Timestamp.from(at));
    }
}
