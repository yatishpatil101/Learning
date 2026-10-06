package com.draazy.api.engagement.pageview;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

/** Not a {@code DemandSignal} (anonymous and sessionless, so no duration).
 * Not a {@code BaseEntity}: a batched flush would share one insert time. */
@Entity
@Table(name = "page_views")
@Getter
public class PageView {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** Minted in the browser into sessionStorage, never derived from viewer traits, which would fingerprint. */
    @Column(name = "session_id", nullable = false, updatable = false)
    @Setter
    private String sessionId;

    /** Set only for a signed-in viewer who accepted analytics cookies; an erasure request nulls it, hence no {@code updatable = false}. */
    @Column(name = "user_id")
    @Setter
    private UUID userId;

    /** Whether the viewer was signed in; what the anonymous-surfers report splits on. */
    @Column(name = "signed_in", nullable = false, updatable = false)
    @Setter
    private boolean signedIn;

    /** The matched route, never the address bar: a query string can carry personal data, so {@link PageViewService} also strips
     * anything after {@code ?} or {@code #} rather than trusting the client. */
    @Column(name = "path", nullable = false, updatable = false)
    @Setter
    private String path;

    /** Host only, never the full referring URL, which on a search engine holds the viewer's query; null is direct arrival or a withheld header, which cannot be told apart. */
    @Column(name = "referrer_host", updatable = false)
    @Setter
    private String referrerHost;

    /** Bucketed in the browser, not from the User-Agent, whose entropy helps fingerprint viewers. */
    @Column(name = "device", nullable = false, updatable = false)
    @Setter
    private String device;

    /** When the view happened, on the server's clock. See the class Javadoc for why not insert time. */
    @Column(name = "occurred_at", nullable = false, updatable = false)
    @Setter
    private Instant occurredAt;
}
