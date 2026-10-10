package com.draazy.api.engagement.flatmate;

import com.draazy.api.catalog.property.DealIntent;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.security.AuthPrincipal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Group applications are not requests: a host binds the whole group to a listing. */
@Service
public class FlatmateApplicationService {

    private final FlatmateGroupApplicationRepository applications;
    private final FlatmateGroupRepository groups;
    private final PropertyRepository properties;
    private final GroupApplicationHydrator hydrator;
    private final Notifier notifier;
    private final AuditService audit;

    public FlatmateApplicationService(FlatmateGroupApplicationRepository applications,
            FlatmateGroupRepository groups, PropertyRepository properties,
            GroupApplicationHydrator hydrator, Notifier notifier, AuditService audit) {
        this.applications = applications;
        this.groups = groups;
        this.properties = properties;
        this.hydrator = hydrator;
        this.notifier = notifier;
        this.audit = audit;
    }

    /** Host view: the card draws the moderation state and the seats; the edit form reads the one group it opens. */
    @Transactional(readOnly = true)
    public Page<FlatmateGroupCard> myGroups(AuthPrincipal caller, Pageable pageable) {
        return groups.findMine(caller.userId(), pageable).map(FlatmateApplicationService::card);
    }

    private static FlatmateGroupCard card(FlatmateGroup group) {
        List<String> localities = group.isHunting() && !group.getLocalities().isEmpty()
                ? List.copyOf(group.getLocalities())
                : group.getLocality() == null ? List.of() : List.of(group.getLocality());
        return new FlatmateGroupCard(group.getId(), group.getTitle(), group.getLocality(), localities,
                group.getRent(), group.getSeatsTotal(), group.openSeats(), group.getMembers().size(),
                group.getPropertyId(), group.getModStatus(), group.getCreatedAt());
    }

    /** Host-only: applying binds every group member to a flat and rent. */
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

    /** Scope by owned listing ids because the application row has no owner column. */
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

    /** Stranger ids return 404, not 403, so application ids do not become existence oracles. */
    @Transactional
    public GroupApplicationDto decide(AuthPrincipal caller, UUID applicationId, String status) {
        String verdict = FlatmateVocabulary.require(
                status == null ? "" : status.strip(), FlatmateVocabulary.DECISION, "status");

        FlatmateGroupApplication application = applications.findById(applicationId)
                .orElseThrow(() -> NotFoundException.of("Group application"));

        Property listing = properties.findById(application.getListingId())
                .filter(p -> p.getOwner() != null && p.getOwner().getId().equals(caller.userId()))
                .orElseThrow(() -> NotFoundException.of("Group application"));

        if (verdict.equals(application.getStatus())) {
            return hydrator.hydrateOne(application);
        }
        if (!FlatmateVocabulary.STATUS_PENDING.equals(application.getStatus())) {
            throw new ConflictException("You have already answered this application.");
        }

        if (applications.updateDecisionIfPending(application.getId(),
                FlatmateVocabulary.STATUS_PENDING, verdict, Instant.now()) == 0) {
            FlatmateGroupApplication current = applications.findById(application.getId())
                    .orElseThrow(() -> NotFoundException.of("Group application"));
            if (verdict.equals(current.getStatus())) {
                return hydrator.hydrateOne(current);
            }
            throw new ConflictException("You have already answered this application.");
        }
        FlatmateGroupApplication decided = applications.findById(application.getId())
                .orElseThrow(() -> NotFoundException.of("Group application"));

        notifier.notify(decided.getApplicantId(), "flatmate.groupApplication." + verdict,
                "accepted".equals(verdict)
                        ? "Your group's application was accepted"
                        : "Your group's application was declined",
                "accepted".equals(verdict)
                        ? "The owner of " + listing.getTitle() + " accepted your group. "
                                + "They will be in touch to arrange the paperwork."
                        : "The owner of " + listing.getTitle() + " declined your group.",
                FlatmateLinks.of("group", decided.getGroupId()));
        audit.record(caller, "flatmate.groupApplication." + verdict, "flatmateGroupApplication",
                decided.getId().toString(), "status", verdict);

        return hydrator.hydrateOne(decided);
    }
}
