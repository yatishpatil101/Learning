package com.punenest.api.engagement.demand;

import com.punenest.api.security.AuthPrincipal;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The only writer of {@link DemandSignal}.
 *
 * <p><strong>Why the write is deliberately dull.</strong> There is no dedupe, no session grouping
 * and no throttle in here. Every one of those is a reporting decision wearing a storage costume: a
 * service that collapses "the same person searched Baner three times" into one row has decided, at
 * write time and permanently, that repeat interest is not interest — and no later report can
 * recover what it threw away. The rows are cheap; the judgement is expensive and belongs to the
 * reader. Volume is bounded by {@code WriteRateLimitFilter}, which caps writes per IP for every
 * mutating route on the platform, so a flood is refused without this method having an opinion.
 *
 * <p><strong>Why it does not resolve the locality.</strong> The client sends a slug and the slug is
 * stored as sent, unvalidated against {@code localities}. A signal for a place we have never heard
 * of is the single most valuable row in the table — it is a person asking for somewhere PuneNest
 * does not cover — and a foreign key would reject it. The report joins for display names and shows
 * the unmatched slugs rather than dropping them.
 */
@Service
public class DemandSignalService {

    private final DemandSignalRepository repository;

    public DemandSignalService(DemandSignalRepository repository) {
        this.repository = repository;
    }

    /**
     * Record one signal.
     *
     * <p>{@code principal} is null for signed-out visitors, which is the common case: the two
     * highest-volume kinds ({@code search}, {@code view}) fire on public surfaces, and the
     * {@code alert} kind is captured deliberately <em>before</em> the sign-in redirect so that
     * cold-start demand is measured even though the alert itself needs an account (D85).
     */
    @Transactional
    public void record(DemandSignalCreate body, AuthPrincipal principal) {
        DemandSignal signal = new DemandSignal();
        signal.setKind(body.kind());
        signal.setLocalitySlug(blankToNull(body.localitySlug()));
        signal.setDeal(blankToNull(body.deal()));
        signal.setBhk(blankToNull(body.bhk()));
        signal.setPropertyId(body.propertyId());
        signal.setUserId(principal == null ? null : principal.userId());
        repository.save(signal);
    }

    /**
     * Empty string and absent mean the same thing here and must not be stored differently.
     *
     * <p>The client sends {@code locality: ''} when no locality filter is set — the mock did the
     * same — so without this the table would hold two distinct representations of "no locality" and
     * the aggregate's {@code group by} would report them as two separate places, one of them named
     * nothing.
     */
    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
