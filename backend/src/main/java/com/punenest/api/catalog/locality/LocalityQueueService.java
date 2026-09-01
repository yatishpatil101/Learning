package com.punenest.api.catalog.locality;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.security.AuthPrincipal;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The locality curation queue — listings the resolver could not place, and the assignment that
 * clears one (register item 24).
 *
 * <p><strong>What was actually broken.</strong> When an owner types a locality that matches nothing
 * curated, {@code LocalityResolver} correctly declines to coin a slug and leaves
 * {@code properties.locality_slug} null for a human to decide. The screen that human opened —
 * Admin ▸ Localities ▸ Pending — read a {@code localStorage} array in their own browser, populated
 * by their own browser, so the real listings waiting on a decision were never in it. The queue
 * showed nothing, looked clear, and the listings were approved unfiled: invisible to locality
 * search, to {@code /locality/{slug}}, to saved-search alerts and to the society join, while their
 * owners were told they were live.
 *
 * <p><strong>Why this is a service of its own and not three methods on
 * {@link LocalityAdminService}.</strong> That class curates the {@code localities} table; every row
 * it touches is a locality. This one reads and writes {@code properties} and never writes a
 * locality — the only thing it does to the reference table is refuse a slug that is not in it. They
 * share a console and nothing else, including their guards: that class is gated on
 * {@code localities:*}, this one on {@code properties:*}, because filing a listing is a change to
 * the listing.
 *
 * <p><strong>The queue is only half the fix.</strong> A queue nobody is obliged to clear is a queue
 * that stays full, which is how the old one survived. The other half is in
 * {@code PropertyModerationService.setStatus}, which now refuses to approve a listing with no
 * locality: that refusal is what turns this screen from a report into a step.
 */
@Service
public class LocalityQueueService {

    /**
     * The statuses worth a curator's attention.
     *
     * <p>{@code rejected} is absent because nothing reads a rejected listing's locality, and
     * {@code sold}/{@code rented} because filing a closed deal changes no surface a visitor sees.
     * {@code flagged} is present: a flagged listing is on its way back to a moderator who will hit
     * the approval block, so it needs to be curatable before they get there.
     */
    private static final Set<String> QUEUED =
            Set.of(PropertyStatus.PENDING, PropertyStatus.APPROVED, PropertyStatus.FLAGGED);

    /**
     * How many rows one read returns.
     *
     * <p>Large enough that the cap is invisible on any normal day and small enough that a bad one
     * cannot make the console the slowest page on the platform. {@link LocalityQueueResponse#total}
     * carries the real figure, so the operator is never shown a truncated count as if it were the
     * whole queue.
     */
    private static final int CAP = 200;

    private final PropertyRepository properties;
    private final LocalityRepository localities;
    private final AuditService audit;

    public LocalityQueueService(PropertyRepository properties, LocalityRepository localities,
            AuditService audit) {
        this.properties = properties;
        this.localities = localities;
        this.audit = audit;
    }

    /**
     * {@code GET /admin/locality-queue} — the oldest listings awaiting a locality.
     *
     * <p>Ordered live-first and then oldest-first. The database returns them oldest-first alone,
     * and the re-sort here is the product judgement the query has no business encoding: an
     * {@code approved} listing with no locality is already published and already missing from every
     * locality surface, so a buyer is being failed by it right now, while a {@code pending} one is
     * merely about to be. Sorting in memory is free — the list is capped at {@link #CAP} before it
     * gets here.
     */
    @Transactional(readOnly = true)
    public LocalityQueueResponse queue() {
        List<LocalityQueueEntry> rows = properties
                .findAwaitingLocality(QUEUED, PageRequest.of(0, CAP)).stream()
                .map(LocalityQueueService::toEntry)
                .sorted(Comparator
                        .comparingInt((LocalityQueueEntry e) ->
                                PropertyStatus.APPROVED.equals(e.status()) ? 0 : 1)
                        .thenComparing(LocalityQueueEntry::createdAt))
                .toList();
        return new LocalityQueueResponse(properties.countAwaitingLocality(QUEUED), rows);
    }

    /**
     * {@code PATCH /admin/locality-queue/{propertyId}} — file one listing under a curated area.
     *
     * <p>The locality must exist and be active. Retired areas are refused rather than accepted
     * quietly, and the distinction matters: {@code active = false} is how a locality is taken out
     * of search facets and off its landing page, so filing a listing under one would move it from
     * "invisible because unfiled" to "invisible because filed somewhere nobody can reach" — the
     * same outcome, now wearing a slug that makes the console look like the job was done.
     *
     * <p>Idempotent in effect but not silently so: re-filing an already-filed listing is refused,
     * because this route's contract is "clear a queue entry" and a listing that already has a
     * locality is not a queue entry. Correcting a wrong assignment is
     * {@code PATCH /properties/{id}}, the owner-and-moderator edit route, which re-runs the
     * resolver — this one must not become a second, unaudited way to move listings between areas.
     */
    @Transactional
    public LocalityQueueEntry assign(AuthPrincipal caller, String propertyId, String slug) {
        Property property = Ids.parseUuid(propertyId)
                .flatMap(properties::findById)
                .or(() -> properties.findBySlug(propertyId))
                .orElseThrow(() -> NotFoundException.of("Property"));

        if (property.getLocalitySlug() != null) {
            throw new ConflictException("That listing already has a locality ('"
                    + property.getLocalitySlug() + "'). Edit the listing to change it.");
        }
        Locality locality = localities.findById(slug)
                .orElseThrow(() -> NotFoundException.of("Locality"));
        if (!locality.isActive()) {
            throw new ConflictException("'" + locality.getName() + "' is retired, so a listing filed"
                    + " under it stays out of search and off its landing page. Reactivate it or"
                    + " pick another area.");
        }

        property.setLocalitySlug(locality.getSlug());
        audit.record(caller, "property.locality", "property", property.getId().toString(),
                "slug", locality.getSlug(), "typed", property.getLocality());
        return toEntry(property);
    }

    private static LocalityQueueEntry toEntry(Property p) {
        return new LocalityQueueEntry(p.getId().toString(), p.getTitle(), p.getLocality(),
                p.getCity(), p.getLat(), p.getLng(), p.getStatus(), p.getLocalitySlug(),
                p.getCreatedAt());
    }
}
