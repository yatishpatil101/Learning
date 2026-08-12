package com.punenest.api.finance.tenancy;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.PageResponse;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The owner-confirmed half of "did this person live here" (D194).
 *
 * <p>Review eligibility is meant to be "completed a visit, <em>or</em> lived here". The second half
 * only existed for people whose tenancy came through a brokered rent deal, which is a small minority
 * of the tenants on any Indian listing — most leases are signed off-platform and the flat is simply
 * listed again afterwards. This service is the other route: the ex-tenant says so, and the owner
 * agrees. Q-ruling: a stay is proven by a brokered agreement <em>or</em> an owner-confirmed
 * self-declaration, and nothing else.
 *
 * <p><strong>The confirmation is the whole feature.</strong> A pending row is a stranger's assertion
 * about somebody else's property and is worth exactly nothing; the platform stores it only so the
 * owner has something to answer. Everything here therefore turns on one check —
 * {@link #requireOwner} compares the caller against the declaration's {@code owner_id}, which was
 * copied off the listing. Accepting any authenticated, or even any identity-verified, caller would
 * be a different and much weaker claim: "someone real said yes" rather than "the landlord said yes",
 * and only the second one is evidence about this flat.
 *
 * <p><strong>Why it lives in {@code finance} beside {@link Tenancy}.</strong> The two answer the
 * same question from different evidence, and {@code PropertyExperienceService} — which sits in
 * {@code deals}, the one context above both — reads them together. Putting the declaration anywhere
 * else would give that adapter a third context to reach into for no gain. Reading
 * {@code PropertyRepository} downward is the permitted cross-context lookup (package-structure §2):
 * it resolves whose listing this is, it does not invoke {@code catalog}'s behaviour.
 */
@Service
public class TenancyDeclarationService {

    private final TenancyDeclarationRepository declarations;
    private final TenancyRepository tenancies;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final AuditService audit;

    public TenancyDeclarationService(TenancyDeclarationRepository declarations,
            TenancyRepository tenancies, PropertyRepository properties, UserRepository users,
            AuditService audit) {
        this.declarations = declarations;
        this.tenancies = tenancies;
        this.properties = properties;
        this.users = users;
        this.audit = audit;
    }

    /**
     * Claim a past stay on a listing.
     *
     * <p>Refusals, in the order a caller most wants to hear them: the listing must exist before we
     * can say who owns it (404); an owner cannot be their own tenant (409, and the message says so
     * rather than pretending the claim is a duplicate); a brokered tenancy already proves the stay,
     * so a declaration on top of it is not refused as invalid but as pointless (409) — it would sit
     * pending forever behind a fact the platform already holds; and a second claim by the same
     * person on the same listing is the same claim again (409), which is what makes a revocation
     * mean anything.
     *
     * @param callerId the claimant
     * @param propertyId the listing they say they lived in
     * @param body optional, untrusted context for the owner
     * @return the stored claim, pending
     */
    @Transactional
    public TenancyDeclarationDto declare(UUID callerId, UUID propertyId,
            TenancyDeclarationCreateRequest body) {
        Property property = properties.findById(propertyId)
                .orElseThrow(() -> NotFoundException.of("Property"));
        UUID ownerId = ownerIdOf(property);
        if (ownerId == null) {
            // A listing with no owner account has nobody who could ever answer, so the claim would
            // be un-decidable rather than merely undecided. Refused at the door with the true
            // reason instead of stored as a row that can only ever be pending.
            throw new ConflictException("This listing has no owner account to confirm a stay");
        }
        if (ownerId.equals(callerId)) {
            throw new ConflictException("You cannot declare a tenancy on your own listing");
        }
        if (tenancies.existsByTenantIdAndPropertyId(callerId, propertyId)) {
            throw new ConflictException("Your tenancy on this listing is already on record");
        }
        if (declarations.existsByPropertyIdAndDeclarantId(propertyId, callerId)) {
            throw new ConflictException("You have already declared a stay at this listing");
        }

        TenancyDeclaration saved = declarations.save(new TenancyDeclaration(
                propertyId, callerId, ownerId, body.livedFrom(), body.livedTo()));
        return projectOne(saved);
    }

    /**
     * What the caller may see about stays claimed on one listing.
     *
     * <p>The listing's owner sees every claim — this is their inbox, and it is on the listing page
     * because a name is only recognisable next to the flat it is about. Everybody else sees their
     * own claim and nothing else, which is what the claimant's own UI needs to know whether to offer
     * "declare", "waiting for the owner" or the review composer.
     *
     * <p>One route rather than two because the difference is a row filter, not a shape: the two
     * sides read the same record, exactly as {@link TenancyDto} is read from both ends. A second
     * endpoint would have to repeat the projection and could drift from it.
     *
     * <p>Paged because the owner's side is inbound demand (api-standards §5.1) — the rows are
     * written by other people. The claimant's side is at most one row and so is always page 0,
     * whatever page they ask for; the filter runs after the fetch, which is correct only because
     * their single row is on every page they could reach.
     */
    @Transactional(readOnly = true)
    public PageResponse<TenancyDeclarationDto> forProperty(UUID callerId, UUID propertyId,
            Pageable pageable) {
        Property property = properties.findById(propertyId)
                .orElseThrow(() -> NotFoundException.of("Property"));
        boolean isOwner = callerId.equals(ownerIdOf(property));
        if (!isOwner) {
            // Not a narrowed page of the owner's inbox — a different, single-row question. Asking it
            // directly keeps a claimant off page 2 of somebody else's queue and reads no row that is
            // not theirs, rather than fetching everyone's and discarding.
            List<TenancyDeclarationDto> mine = project(
                    declarations.findByPropertyIdAndDeclarantId(propertyId, callerId).stream()
                            .toList());
            return new PageResponse<>(mine, 0, Math.max(mine.size(), 1), mine.size(),
                    mine.isEmpty() ? 0 : 1, "createdAt,desc");
        }
        Page<TenancyDeclaration> page =
                declarations.findByPropertyIdOrderByCreatedAtDesc(propertyId, pageable);
        return PageResponse.of(page, projector(page.getContent()));
    }

    /**
     * The owner agrees that this person lived there. Idempotent, and re-confirmable after a
     * revocation — an owner who mis-tapped a name should be able to simply tap the right thing.
     */
    @Transactional
    public TenancyDeclarationDto confirm(AuthPrincipal caller, UUID declarationId) {
        return decide(caller, declarationId, TenancyDeclarationStatuses.CONFIRMED);
    }

    /**
     * The owner disagrees, or takes back a confirmation they already gave.
     *
     * <p>A status change and not a delete. Eligibility stops either way, but the trail — claimed,
     * agreed, withdrawn — is exactly what an abuse investigation needs, and a deleted row says
     * nothing at all. It also stops the claimant simply re-declaring, since the unique constraint
     * still holds the slot.
     *
     * <p><strong>Forward-only, and deliberately so (D204). Do not add retraction here.</strong>
     * This method touches no review. A review written while the stay was confirmed stays published,
     * keeps its {@code tenant} badge and keeps counting towards the listing's rating; all revoking
     * does is stop {@code common.trust.PropertyExperience} authorising the <em>next</em> one. The
     * missing step looks like an oversight and is not: retracting the review would hand the owner of
     * the listing being reviewed a one-tap silencer for criticism — confirm the stay, wait for the
     * review, revoke on reading it. The declaration's job is to evidence that the reviewer was
     * really there, which is a fact about the past that revoking cannot alter; what revocation
     * honestly says is "I no longer stand behind this claim", and its honest consequence is that the
     * claim buys nothing further. The confirm → review → revoke sequence is answered by the audit
     * row below and by review moderation, both held by somebody other than the accused.
     * {@code TenancyRevocationIsForwardOnlyTest} pins both halves.
     */
    @Transactional
    public TenancyDeclarationDto revoke(AuthPrincipal caller, UUID declarationId) {
        return decide(caller, declarationId, TenancyDeclarationStatuses.REVOKED);
    }

    private TenancyDeclarationDto decide(AuthPrincipal caller, UUID declarationId, String status) {
        TenancyDeclaration row = requireOwner(caller.userId(), declarationId);
        String previous = row.getStatus();
        if (previous.equals(status)) {
            // Idempotent in the strict sense: a second confirm changes nothing and is not logged.
            // Re-stamping `decided_at` and appending a from=confirmed,to=confirmed row would be
            // noise in the one trail an abuse review reads, and a double-tap is not an event.
            return projectOne(row);
        }
        row.decide(status);
        /* Audited, and this is the only action in the slice that is. The row itself keeps just the
           current status and the last `decided_at`, so a confirm → revoke → confirm cycle is
           indistinguishable in the table from a first-time confirm — while the sequence is the whole
           signal an abuse review would look for. It matters more here than on most owner actions,
           because confirming is what hands a stranger the right to publish on this listing, and the
           obvious way to fake a review is for an owner to confirm an account they control. That is
           not detectable from the row; it is detectable from the log. */
        audit.record(caller, "tenancy_declaration." + status, "tenancy_declaration",
                declarationId.toString(), "from", previous, "to", status,
                "declarantId", String.valueOf(row.getDeclarantId()),
                "propertyId", String.valueOf(row.getPropertyId()));
        return projectOne(row);
    }

    /**
     * Load a declaration the caller is entitled to decide, or answer 404.
     *
     * <p><strong>404 and never 403</strong>, matching the tenant-profile read: a 403 would confirm
     * to a stranger that a particular declaration id exists, which is a fact about somebody else's
     * property and somebody else's claim on it.
     */
    private TenancyDeclaration requireOwner(UUID callerId, UUID declarationId) {
        return declarations.findById(declarationId)
                .filter(d -> callerId.equals(d.getOwnerId()))
                .orElseThrow(() -> NotFoundException.of("Tenancy declaration"));
    }

    /** The listing's owner account, or null for a listing nobody on the platform holds. */
    private UUID ownerIdOf(Property property) {
        return property.getOwner() == null ? null : property.getOwner().getId();
    }

    /**
     * The single-row case of {@link #project}, which is what every write path answers with. Named
     * rather than repeated so the wrap-and-unwrap that each of them would otherwise spell out
     * ({@code project(List.of(row)).get(0)}) is written once.
     */
    private TenancyDeclarationDto projectOne(TenancyDeclaration row) {
        return project(List.of(row)).get(0);
    }

    /**
     * Resolve declarant names in one query rather than one per row — the owner's inbox renders a
     * list, and a per-row lookup is an N+1 on a render path.
     */
    private List<TenancyDeclarationDto> project(List<TenancyDeclaration> rows) {
        return rows.stream().map(projector(rows)).toList();
    }

    /**
     * The same batch name resolution, handed back as a per-row function so a {@link PageResponse}
     * can be built from the page itself — mapping the list separately and then re-joining it to the
     * page by id was a second index over data already in hand.
     *
     * <p>The returned function is only valid for the rows it was built from; anything else projects
     * an empty name.
     */
    private Function<TenancyDeclaration, TenancyDeclarationDto> projector(
            List<TenancyDeclaration> rows) {
        Set<UUID> ids = rows.stream().map(TenancyDeclaration::getDeclarantId)
                .filter(Objects::nonNull).collect(Collectors.toSet());
        Map<UUID, User> byId = ids.isEmpty() ? Map.of()
                : users.findAllById(ids).stream()
                        .collect(Collectors.toMap(User::getId, Function.identity()));
        return row -> TenancyMapper.toDto(row, byId.get(row.getDeclarantId()));
    }
}
