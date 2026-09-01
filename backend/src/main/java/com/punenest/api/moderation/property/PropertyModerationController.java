package com.punenest.api.moderation.property;

import com.punenest.api.catalog.listing.ListingService;
import com.punenest.api.catalog.listing.ListingUpdate;
import com.punenest.api.catalog.property.PropertyMapper;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyResponse;
import com.punenest.api.catalog.property.PropertySearchQuery;
import com.punenest.api.catalog.property.PropertyService;
import com.punenest.api.common.trust.BackOfficeVisibility;
import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.trust.MessageSender;
import com.punenest.api.common.trust.OutreachCounts;
import com.punenest.api.common.trust.PrivateFieldVisibility;
import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Listing moderation endpoints (contract tag {@code Moderation}).
 *
 * <p>The four moderator-only routes carry {@code @PreAuthorize} matching the {@code x-roles} the
 * contract gained in spec fix S28. {@code archive}/{@code restore} deliberately do not: they are
 * dual-audience (owner <em>or</em> staff) and their guard lives in the service, because
 * {@code @PreAuthorize} can express "is staff" but not "is staff or owns this row".
 *
 * <p>The status routes carry no response body. That is the contract's choice, not an omission —
 * {@code setPropertyStatus}, {@code toggleFeatured}, {@code flagProperty}, {@code archiveProperty}
 * and {@code restoreProperty} all declare a bare {@code '200': { description: ... }} with no schema.
 * The admin UI re-reads the listing after acting. {@code adminUpdateProperty} is the exception: it
 * returns the listing, because it is the only one whose effect the caller cannot predict from the
 * request they sent.
 *
 * <p><strong>{@code adminUpdateProperty} maps here but does its work in
 * {@code catalog.listing.ListingService}.</strong> Its body is {@code ListingUpdate}, i.e. all of
 * {@code ListingCreate} made optional, and the owner-facing update already applies exactly that
 * mapping. Rebuilding it here would guarantee two copies that drift, so the two paths share one
 * private {@code apply} and differ only in what they do afterwards — an owner's edit re-opens
 * moderation, a moderator's does not (slice 15).
 *
 * <p><strong>Also not here:</strong> {@code archive}/{@code restore}. They already ship in
 * {@code catalog.property.PropertyController}, authorized owner-or-staff in the service — which is
 * the dual-audience rule spec fix S28 recorded, already correctly implemented in slice 2.
 */
@RestController
public class PropertyModerationController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    /** Seeing the queue. */
    private static final String PROPERTIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_READ;

    /**
     * Acting on a listing — approve, reject, feature, flag, correct.
     *
     * <p>One atom for all five rather than a finer split. The console offers them from the same row
     * of the same table, so an account that can reach any of them can reach all of them, and a
     * vocabulary that pretended otherwise would be describing a screen that does not exist.
     */
    private static final String PROPERTIES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_WRITE;

    /**
     * Creating a listing owned by somebody else.
     *
     * <p>Its own atom, deliberately not {@link #PROPERTIES_WRITE} — see
     * {@link OnBehalfListingService}. This is the only route on the platform where the caller names
     * the owner of what they create.
     */
    private static final String POST_ON_BEHALF_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_POSTONBEHALF_WRITE;

    private final PropertyModerationService service;
    private final ListingService listings;
    private final PropertyService propertyService;
    private final PropertyMapper propertyMapper;
    private final OnBehalfListingService onBehalf;
    private final PropertyModerationSummaryRepository summaries;
    private final OwnerOutreachService outreach;

    public PropertyModerationController(PropertyModerationService service, ListingService listings,
            PropertyService propertyService, PropertyMapper propertyMapper,
            OnBehalfListingService onBehalf, PropertyModerationSummaryRepository summaries,
            OwnerOutreachService outreach) {
        this.service = service;
        this.listings = listings;
        this.propertyService = propertyService;
        this.propertyMapper = propertyMapper;
        this.onBehalf = onBehalf;
        this.summaries = summaries;
        this.outreach = outreach;
    }

    /**
     * {@code GET /admin/properties} (contract {@code listPropertiesForModeration}) — the queue.
     *
     * <p>The read the other five operations here shipped without. Every one of them addresses a
     * listing by {@code {id}}, and until now nothing on the platform could produce such an id for an
     * unapproved listing: {@code GET /properties} pins {@code status='approved' AND archived=false}
     * unconditionally (it takes no principal, so it cannot relax for staff), and
     * {@code GET /me/listings} is scoped to the caller's own {@code owner_id}. A moderator could
     * approve a listing only if someone told them it existed.
     *
     * <p>{@code status}, {@code archived} and {@code recheck} are the axes the public search cannot
     * express; the latter two are tri-state ({@code null} = both) because "everything" and "only the
     * live ones" are different questions. The remaining facets are shared with the public search
     * verbatim, so a moderator filtering by locality gets the same semantics a seeker does.
     *
     * <p>{@code recheck=true} is the stays-live queue (Q14) and is a third axis rather than another
     * {@code status} value for the reason that outcome exists at all: every status except
     * {@code approved} is off search, so expressing "waiting for a moderator" as a status would
     * re-impose the exact cost the split was introduced to avoid.
     *
     * <p>Rendered {@link ContactVisibility#REVEALED}, and this controller reversed itself on that.
     * It previously masked, on the reasoning that a list exposes numbers in bulk rather than one at
     * a time. That reasoning was sound about the risk and wrong about the job: the desk this feeds
     * exists to phone owners whose listings are stuck, and a moderator who cannot read the number
     * simply looks it up somewhere the platform cannot see, which trades an audited disclosure for
     * an unaudited one. The mask never protected the owner from staff — it only protected staff
     * from being recorded.
     *
     * <p>What still holds is that this is the <em>only</em> reason to reveal. The gate
     * ({@code owner|approved|pending|declined|none}) governs seekers, and no amount of back-office
     * role satisfies it; what governs here is {@code properties:read}, an atom granted per account.
     */
    @GetMapping(Routes.Moderation.ADMIN_PROPERTIES)
    @PreAuthorize(PROPERTIES_READ)
    public PageResponse<PropertyResponse> queue(
            @RequestParam(required = false) String deal,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String locality,
            @RequestParam(required = false) Integer bhk,
            @RequestParam(required = false) Long minPrice,
            @RequestParam(required = false) Long maxPrice,
            @RequestParam(required = false) String furnishing,
            @RequestParam(required = false) String possession,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Boolean archived,
            @RequestParam(required = false) Boolean recheck,
            @PageableDefault(size = 20) Pageable pageable) {
        // The owner facet exists for the public profile page and is deliberately not offered here:
        // the moderation desk already finds an owner's stock through the user record, and adding a
        // second way in would be a filter nobody maintains.
        PropertySearchQuery filters = new PropertySearchQuery(
                deal, type, locality, bhk, minPrice, maxPrice, furnishing, possession, q, status,
                null);
        Page<Property> page = propertyService.searchForModeration(filters, archived, recheck, pageable);
        OutreachCounts counts = outreach.countsFor(page.getContent());
        return PageResponse.of(page,
                p -> propertyMapper.toResponse(p, ContactVisibility.REVEALED,
                        BackOfficeVisibility.VISIBLE, counts, PrivateFieldVisibility.VISIBLE));
    }

    /**
     * {@code GET /admin/properties/summary} (contract {@code propertyModerationSummary}) — the
     * console's headline counts, over every listing rather than over the page just fetched.
     *
     * <p>Takes no filters, deliberately. These are the platform's totals; a strip that narrowed
     * with the console's search box would be a second rendering of the table's own row count, and
     * the question it exists to answer — "how much is waiting that I am not looking at" — is
     * precisely the one a filtered count cannot answer.
     */
    @GetMapping(Routes.Moderation.ADMIN_PROPERTIES_SUMMARY)
    @PreAuthorize(PROPERTIES_READ)
    public PropertyModerationSummary summary() {
        return summaries.summary();
    }

    /** {@code PATCH /properties/{id}/status} (contract {@code setPropertyStatus}). */
    @PatchMapping(Routes.Moderation.PROPERTY_STATUS)
    @PreAuthorize(PROPERTIES_WRITE)
    public void setStatus(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody StatusRequest body) {
        service.setStatus(principal, id, body.status(), body.reason());
    }

    /** {@code POST /properties/{id}/toggle-featured} (contract {@code toggleFeatured}). */
    @PostMapping(Routes.Moderation.PROPERTY_FEATURED)
    @PreAuthorize(PROPERTIES_WRITE)
    public void toggleFeatured(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.toggleFeatured(principal, id);
    }

    /** {@code POST /properties/{id}/flag} (contract {@code flagProperty}). */
    @PostMapping(Routes.Moderation.PROPERTY_FLAG)
    @PreAuthorize(PROPERTIES_WRITE)
    public void flag(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody ReasonRequest body) {
        service.flag(principal, id, body.reason());
    }

    /** {@code DELETE /properties/{id}/flag} (contract {@code clearFlag}) — 204. */
    @DeleteMapping(Routes.Moderation.PROPERTY_FLAG)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize(PROPERTIES_WRITE)
    public void clearFlag(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.clearFlag(principal, id);
    }

    /**
     * {@code PATCH /properties/{id}/admin} (contract {@code adminUpdateProperty}) — correct another
     * user's listing in place.
     *
     * <p>The one moderation route that returns a body, because it is the one that changes fields
     * the moderator chose rather than a status they can already see. Rendered
     * {@link ContactVisibility#REVEALED}, like {@link #queue} — a moderator correcting somebody
     * else's listing is the caller most likely to need to ring them about it.
     *
     * <p>The work is delegated to {@link ListingService#updateAsModerator}, which owns the single
     * copy of the {@code ListingUpdate} field mapping — see this class's Javadoc.
     */
    @PatchMapping(Routes.Moderation.PROPERTY_ADMIN_UPDATE)
    @PreAuthorize(PROPERTIES_WRITE)
    public PropertyResponse adminUpdate(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody ListingUpdate body) {
        Property updated = listings.updateAsModerator(principal, id, body);
        return propertyMapper.toResponse(updated, ContactVisibility.REVEALED,
                BackOfficeVisibility.VISIBLE, outreach.countsFor(List.of(updated)),
                PrivateFieldVisibility.VISIBLE);
    }

    /**
     * {@code POST /admin/properties} — post a listing on an owner's behalf; 201.
     *
     * <p>Same path as {@link #queue}, different method, and the pairing is exact: {@code GET} is the
     * supply an operator moderates, {@code POST} is supply an operator adds. Both are the
     * back-office's view of {@code /properties}, which is why neither lives under it.
     *
     * <p>Carries {@link #POST_ON_BEHALF_WRITE} rather than {@code properties:write} — this is the
     * one route where the caller names somebody else as the owner of what they create. See
     * {@link OnBehalfListingService}.
     *
     * <p>Rendered {@link ContactVisibility#REVEALED}, like every other response on this controller.
     * Here it is not even a disclosure: the operator typed this number into the request a moment
     * ago, so masking it on the way back would have hidden a value from the only person who already
     * had it, while making the response inconsistent with the queue the new listing lands in.
     */
    @PostMapping(Routes.Moderation.ADMIN_PROPERTIES)
    @PreAuthorize(POST_ON_BEHALF_WRITE)
    @ResponseStatus(HttpStatus.CREATED)
    public PropertyResponse createOnBehalf(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody OnBehalfListingRequest body) {
        // NONE rather than a lookup: the listing did not exist a moment ago, so nobody can have
        // chased its owner about it. Querying would be a round trip guaranteed to return zero.
        return propertyMapper.toResponse(onBehalf.create(principal, body), ContactVisibility.REVEALED,
                BackOfficeVisibility.VISIBLE, OutreachCounts.NONE, PrivateFieldVisibility.VISIBLE);
    }

    /**
     * {@code POST /properties/{id}/pipeline} — move a staff-posted listing along the owner
     * hand-back funnel.
     *
     * <p>{@link #POST_ON_BEHALF_WRITE}, matching {@link #createOnBehalf}: the funnel only exists for
     * listings that route created, and reporting on a liability belongs with the power to open it.
     *
     * <p>Rendered {@link BackOfficeVisibility#VISIBLE} — the caller is the desk the funnel is for,
     * and returning the listing without the stage it was just moved to would make the response
     * useless for the board that issued the call.
     */
    @PostMapping(Routes.Moderation.PROPERTY_PIPELINE)
    @PreAuthorize(POST_ON_BEHALF_WRITE)
    public PropertyResponse advancePipeline(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody PipelineRequest body) {
        Property moved = onBehalf.advance(principal, id, body.stage());
        return propertyMapper.toResponse(moved, ContactVisibility.REVEALED,
                BackOfficeVisibility.VISIBLE, outreach.countsFor(List.of(moved)),
                PrivateFieldVisibility.VISIBLE);
    }

    /** Body of {@code advancePropertyPipeline}. */
    public record PipelineRequest(@NotBlank String stage) {
    }

    /**
     * {@code POST /properties/{id}/outreach} — chase this listing's owner.
     *
     * <p>Returns the composed message and a {@code handoffLink} the console opens, which is where
     * the send actually happens: WhatsApp opens on the staff member's own device with the text
     * typed out and they press send. See {@link com.punenest.api.common.trust.MessageSender} for why
     * the server records this as {@code prepared} rather than claiming a delivery it cannot witness.
     *
     * <p>{@link #POST_ON_BEHALF_WRITE}. The atom is named for creating listings on somebody's
     * behalf, and this is the same power pointed at the same people: it puts a message on a member
     * of the public's personal phone, in the platform's name, unprompted. An operator trusted to
     * manufacture a listing under a stranger's number is trusted to message that number; an operator
     * granted only {@code properties:write} — moderating supply that already exists — is not.
     */
    @PostMapping(Routes.Moderation.PROPERTY_OUTREACH)
    @PreAuthorize(POST_ON_BEHALF_WRITE)
    public MessageSender.Prepared chaseOwner(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody OutreachRequest body) {
        return outreach.chase(principal, id, body.templateId());
    }

    /**
     * {@code GET /properties/{id}/outreach} — every chaser sent to this listing's owner.
     *
     * <p>Readable with {@link #PROPERTIES_READ} rather than the write atom that produced the rows,
     * because the point of a shared log is that the colleague about to phone this owner can check
     * whether somebody already has. Gating the history behind the permission to add to it would
     * leave exactly the person who should back off unable to find out.
     */
    @GetMapping(Routes.Moderation.PROPERTY_OUTREACH)
    @PreAuthorize(PROPERTIES_READ)
    public List<OwnerOutreachService.OwnerOutreachEntry> outreachHistory(@PathVariable String id) {
        return outreach.history(id);
    }

    /** Body of {@code sendOwnerOutreach}. */
    public record OutreachRequest(@NotBlank String templateId) {
    }

    /** Body of {@code setPropertyStatus} (schema {@code PropertyStatusUpdate}). */
    public record StatusRequest(@NotBlank String status, String reason) {    }    /** Body of {@code flagProperty} (schema {@code ReasonRequest}). */
    public record ReasonRequest(String reason) {
    }
}
