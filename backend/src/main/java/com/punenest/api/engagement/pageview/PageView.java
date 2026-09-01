package com.punenest.api.engagement.pageview;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

/**
 * One page view. The raw grain behind the Traffic, Engagement and Anonymous-surfers reports.
 *
 * <p><strong>Not a {@code Visit}.</strong> A visit on this platform is a person going to look at a
 * property in the physical world. This is a route rendered in a browser. The two are one underscore
 * apart in the schema if you let them be, so nothing here says "visit".
 *
 * <p><strong>Why this is not a {@code DemandSignal}.</strong> A demand signal records that somebody
 * wanted a home in a locality; this records that a browser rendered a route. They look similar and
 * answer disjoint questions. A demand signal has no session, so two of them cannot be shown to
 * belong to one browsing session — which makes duration, bounce rate and distinct-viewer counts
 * underivable from it in principle rather than merely absent — and it has no page, so every surface
 * that is not a search or a listing emits nothing at all. Folding page views into it would have
 * meant widening a deliberately anonymous, aggregate-only table into a per-session browsing record,
 * which is a different privacy posture wearing the same table name.
 *
 * <p><strong>Why it does not extend {@code BaseEntity}.</strong> That superclass supplies
 * {@code created_at} with {@code @CreationTimestamp} — the moment the row was written. This table
 * needs the moment the view <em>happened</em>, and the two are genuinely different here because the
 * client batches: a session that lasts twenty seconds can arrive in a single flush. Inheriting the
 * insert timestamp would stamp every row in a batch identically and compute that session's duration
 * as zero, silently, for exactly the short sessions the bounce rate is about. So the column is
 * {@code occurred_at} and it is set from a client-supplied offset — see
 * {@link PageViewService#record}, which anchors that offset to the server clock rather than
 * trusting a browser's.
 *
 * <p><strong>Append-only.</strong> No update path, no archive flag, no moderation. The setters exist
 * for construction; {@link PageViewService} is the sole writer. The one field ever written again is
 * {@code userId}, and only by an erasure request nulling it.
 */
@Entity
@Table(name = "page_views")
@Getter
public class PageView {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * Groups the views of one browsing session. Minted in the browser, held in
     * {@code sessionStorage}.
     *
     * <p>It dies with the tab, so it is never correlated across visits and cannot accumulate into a
     * profile. Deliberately not derived from anything about the viewer — not the address, not the
     * User-Agent, not a signed-in id — because a token derived from those is a fingerprint that
     * survives sign-out, which is precisely what a "sessionStorage token" sounds like it is not.
     */
    @Column(name = "session_id", nullable = false, updatable = false)
    @Setter
    private String sessionId;

    /**
     * Null for signed-out viewers, which is the majority and is the entire point: the
     * Anonymous-surfers report is the difference between null and not-null in this column.
     *
     * <p>The one mutable field on the entity, and only in one direction — an erasure request nulls
     * it, leaving the view counted and the viewer unnamed. Hence no {@code updatable = false} here,
     * where every other column has it.
     */
    @Column(name = "user_id")
    @Setter
    private UUID userId;

    /**
     * The matched route, never the address bar: {@code /property/:id}, not
     * {@code /property/kothrud-2bhk?utm_source=x}.
     *
     * <p>A query string carries search terms and referral identifiers, so storing a raw URL would
     * put free-text personal data into a table whose whole justification is that it holds none. The
     * client sends the pattern and {@link PageViewService} strips anything after {@code ?} or
     * {@code #} regardless — a client-side convention that the server does not enforce is a
     * convention that one forgotten call site quietly breaks.
     */
    @Column(name = "path", nullable = false, updatable = false)
    @Setter
    private String path;

    /**
     * Host only — {@code google.com}, never the full referring URL, which on a search engine
     * contains the query the viewer typed.
     *
     * <p>Null means direct arrival or a browser that withheld the header. Those two are not
     * distinguishable and the report does not pretend otherwise.
     */
    @Column(name = "referrer_host", updatable = false)
    @Setter
    private String referrerHost;

    /**
     * {@code mobile}, {@code tablet} or {@code desktop}, bucketed in the browser from the viewport.
     *
     * <p>Deliberately not the User-Agent string, which carries enough entropy to help fingerprint a
     * viewer across sessions. Three buckets cannot single anybody out, and three buckets is all the
     * device-split chart has ever displayed.
     */
    @Column(name = "device", nullable = false, updatable = false)
    @Setter
    private String device;

    /** When the view happened, on the server's clock. See the class Javadoc for why not insert time. */
    @Column(name = "occurred_at", nullable = false, updatable = false)
    @Setter
    private Instant occurredAt;
}
