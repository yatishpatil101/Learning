package com.punenest.api.engagement.flatmate;

import com.punenest.api.catalog.property.DealIntent;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.Notifier;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * A formed flatmate group applying to an owner's whole-flat rent listing.
 *
 * <p><strong>This is the other half of {@link FlatmateGroupApplication}.</strong> The row, its
 * table, its two check constraints, its {@code decide} method and the admin moderation board all
 * existed already — but nothing on the API ever created one, and nothing ever called
 * {@code decide}. The admin board was therefore a correct, guarded, paged read over a table that
 * could not acquire a row. This service is the missing supply.
 *
 * <p><strong>Why this is not {@link FlatmateRequest}.</strong> A request is one person asking one
 * host for one seat in a flat that already has occupants. An application is a whole group asking an
 * owner for a whole flat. Both ends differ and so does the direction, which is why the two have
 * separate tables, separate routes and separate services rather than a {@code kind} column that
 * every query would then have to remember to filter on.
 *
 * <p><strong>The owner's axis only.</strong> Everything here writes {@code status} and never
 * {@code modStatus} — the mirror of {@link FlatmateModerationService#moderateApplication}, which
 * writes {@code modStatus} and never {@code status}. "The owner said no" and "we took this down"
 * are different facts; the entity enforces the split by exposing two methods that cannot reach each
 * other's field, and the two services keep it visible at the call site.
 *
 * <p><strong>{@link #myGroups} lives here rather than with the rest of the group writes</strong>
 * because it exists for this flow: it is the query that answers "which of my groups could apply to
 * this flat", and its caller renders the apply button from the {@code seatsOpen} and
 * {@code propertyId} that the public feed projection drops. {@code FlatmateSupplyService} is one of
 * the six services grandfathered over the split trigger, so new behaviour goes to the use-case that
 * needs it rather than onto the pile.
 */
@Service
public class FlatmateApplicationService {

    private final FlatmateGroupApplicationRepository applications;
    private final FlatmateGroupRepository groups;
    private final PropertyRepository properties;
    private final GroupApplicationHydrator hydrator;
    private final FlatmateMapper mapper;
    private final UserRepository users;
    private final Notifier notifier;
    private final AuditService audit;
    /** The Ops verdict behind a group's tier badge, batched once per window. */
    private final FlatmateReviewStatuses reviewStatuses;

    public FlatmateApplicationService(FlatmateGroupApplicationRepository applications,
            FlatmateGroupRepository groups, PropertyRepository properties,
            GroupApplicationHydrator hydrator, FlatmateMapper mapper, UserRepository users,
            Notifier notifier, AuditService audit, FlatmateReviewStatuses reviewStatuses) {
        this.applications = applications;
        this.groups = groups;
        this.properties = properties;
        this.hydrator = hydrator;
        this.mapper = mapper;
        this.users = users;
        this.notifier = notifier;
        this.audit = audit;
        this.reviewStatuses = reviewStatuses;
    }

    /**
     * {@code GET /me/flatmate-groups} — the groups this caller started.
     *
     * <p>Full {@link FlatmateGroupDto}, not the feed's card projection: the caller is the host, so
     * there is nothing on the row they are not entitled to, and the surfaces that need this need
     * the fields the card drops — {@code seatsOpen} and {@code propertyId} to decide whether a
     * group can apply to a flat, {@code modStatus} to explain why it is not showing publicly yet.
     *
     * <p>Includes groups still awaiting moderation, deliberately. Hiding them would show a host an
     * empty list minutes after they created a group, which reads as data loss rather than as a
     * queue.
     */
    @Transactional(readOnly = true)
    public Page<FlatmateGroupDto> myGroups(AuthPrincipal caller, Pageable pageable) {
        // The caller's own view of their own rows: name and number both present, because it is
        // their number on a request they authenticated. One lookup for the whole page.
        User me = users.findById(caller.userId()).orElse(null);
        String name = me == null ? null : me.getName();
        String mobile = me == null ? null : me.getMobile();
        Page<FlatmateGroup> page = groups.findMine(caller.userId(), pageable);
        /* The Ops verdict per row, batched for the window. A host needs this more than a stranger
           does: it is what tells them their agreement is still being looked at rather than that
           their badge silently failed to appear. Per-row it would be one query per group. */
        Map<UUID, String> verdicts = reviewStatuses.forGroups(page.getContent());
        return page.map(g -> mapper.toDto(g,
                new FlatmateMapper.PartyView(name, mobile, verdicts.get(g.getId()))));
    }

    /**
     * {@code POST /flatmates/groups/{id}/apply} — commit a group to a listing.
     *
     * <p><strong>Host-only, deliberately.</strong> An application binds every member of the group
     * to a flat and a rent; a member who joined yesterday must not be able to sign the other three
     * up for it. This also matches what the row stores — {@code applicant_id} is documented as the
     * group's host — so any other rule would make that column a lie.
     *
     * <p>The listing must be publicly visible <em>and</em> a rental. Applying to a pending listing
     * would put the group in a queue behind a moderation decision they cannot see, and applying to
     * a sale listing is a category error: {@code price} means the whole consideration there, so the
     * per-head figure the group is shown would be off by two orders of magnitude.
     */
    @Transactional
    public GroupApplicationDto apply(AuthPrincipal caller, UUID groupId, UUID listingId) {
        FlatmateGroup group = groups.findById(groupId)
                .orElseThrow(() -> NotFoundException.of("Flatmate group"));
        if (!group.getHostId().equals(caller.userId())) {
            throw new BadRequestException(
                    "Only the person who started this group can apply it to a flat.");
        }
        if (!group.isVisible()) {
            throw new BadRequestException(
                    "This group is not live yet, so it cannot apply to a flat.");
        }

        Property listing = properties.findById(listingId)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        if (!listing.isPubliclyVisible()) {
            throw new BadRequestException("That listing is not accepting enquiries.");
        }
        if (!DealIntent.RENT.equals(listing.getDeal())) {
            throw new BadRequestException("A group can only apply to a rental listing.");
        }
        if (listing.getOwner() != null && listing.getOwner().getId().equals(caller.userId())) {
            throw new BadRequestException("This is your own listing.");
        }
        if (applications.existsByListingIdAndGroupId(listingId, groupId)) {
            throw new ConflictException(
                    "Your group has already applied to this flat — the owner has it.");
        }

        FlatmateGroupApplication saved = applications.saveAndFlush(
                new FlatmateGroupApplication(listingId, groupId, caller.userId()));

        if (listing.getOwner() != null) {
            notifier.notify(listing.getOwner().getId(), "flatmate.groupApplication.received",
                    "A group applied to your flat",
                    group.getTitle() + " would like to rent " + listing.getTitle() + ".",
                    "/dashboard");
        }
        audit.record(caller, "flatmate.groupApplication.create", "flatmateGroupApplication",
                saved.getId().toString(), "listingId", listingId.toString());

        return hydrator.hydrateOne(saved);
    }

    /**
     * {@code GET /me/group-applications} — the owner inbox, newest first, paged.
     *
     * <p>Scoped by the caller's listing ids rather than by an {@code owner_id} column, because the
     * row has no owner: ownership is a fact about the listing and can change. An owner with no
     * listings short-circuits to an empty page rather than issuing an {@code in ()} query.
     *
     * <p>Moderation-removed applications are excluded here and only here. An admin taking down a
     * spam application must not thereby decline it on the owner's behalf, so {@code status} is left
     * alone and this predicate is the only thing keeping the row off the screen.
     */
    @Transactional(readOnly = true)
    public Page<GroupApplicationDto> inbox(AuthPrincipal caller, Pageable pageable) {
        List<UUID> listingIds = properties.findIdsByOwnerId(caller.userId());
        if (listingIds.isEmpty()) {
            return Page.empty(pageable);
        }
        Page<FlatmateGroupApplication> page =
                applications.findByListingIdInAndModStatusInOrderByCreatedAtDesc(
                        listingIds, FlatmateVocabulary.MOD_PUBLIC, pageable);
        return new PageImpl<>(hydrator.hydrate(page.getContent()), page.getPageable(),
                page.getTotalElements());
    }

    /**
     * {@code PATCH /me/group-applications/{id}} — the owner accepts or declines.
     *
     * <p>Scoped by looking the application up and then checking the caller owns its listing, which
     * is why a stranger's application id produces a 404 rather than a 403: an id that resolves for
     * one caller and refuses for another is an existence oracle, and the contract's own
     * owner-scoped finders take the same line.
     *
     * <p>A decided application cannot be re-decided. The check constraint pairs {@code decided_at}
     * with the status, so a second write would move the timestamp and quietly rewrite when the
     * owner made up their mind.
     */
    @Transactional
    public GroupApplicationDto decide(AuthPrincipal caller, UUID applicationId, String status) {
        String verdict = FlatmateVocabulary.require(
                status == null ? "" : status.strip(), FlatmateVocabulary.DECISION, "status");

        FlatmateGroupApplication application = applications.findById(applicationId)
                .orElseThrow(() -> NotFoundException.of("Group application"));

        Property listing = properties.findById(application.getListingId())
                .filter(p -> p.getOwner() != null && p.getOwner().getId().equals(caller.userId()))
                .orElseThrow(() -> NotFoundException.of("Group application"));

        if (!FlatmateVocabulary.STATUS_PENDING.equals(application.getStatus())) {
            throw new ConflictException("You have already answered this application.");
        }

        application.decide(verdict);
        applications.saveAndFlush(application);

        notifier.notify(application.getApplicantId(), "flatmate.groupApplication." + verdict,
                "accepted".equals(verdict)
                        ? "Your group's application was accepted"
                        : "Your group's application was declined",
                "accepted".equals(verdict)
                        ? "The owner of " + listing.getTitle() + " accepted your group. "
                                + "They will be in touch to arrange the paperwork."
                        : "The owner of " + listing.getTitle() + " declined your group.",
                "/flatmates");
        audit.record(caller, "flatmate.groupApplication." + verdict, "flatmateGroupApplication",
                application.getId().toString(), "status", verdict);

        return hydrator.hydrateOne(application);
    }
}
