package com.punenest.api.moderation.verification;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.security.AccountPermissions;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.Roles;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The owner&lt;-&gt;ops listing verification workflow.
 *
 * <p><strong>Access here is participant-or-staff, not role-based</strong>, and the contract says so:
 * the four thread operations deliberately carry no {@code x-roles} (recorded explicitly in spec fix
 * S28) because the listing owner is one of the two participants. Role-gating the thread would have
 * locked owners out of the conversation about their own listing — the single most user-visible way
 * this slice could have gone wrong. Only {@code verificationDecision}, the checker half of the
 * maker-checker pair, is staff/admin.
 *
 * <p>A caller who is neither participant nor staff gets a <strong>404, not a 403</strong>. A 403
 * would confirm that a listing with that id exists and is under review, which is exactly the fact a
 * competitor would probe for.
 */
@Service
public class PropertyVerificationService {

    private final PropertyReviewRepository reviews;
    private final PropertyRepository properties;
    private final VerificationCases cases;
    private final AccountPermissions permissions;
    private final AuditService audit;

    public PropertyVerificationService(PropertyReviewRepository reviews, PropertyRepository properties,
            VerificationCases cases, AccountPermissions permissions, AuditService audit) {
        this.reviews = reviews;
        this.properties = properties;
        this.cases = cases;
        this.permissions = permissions;
        this.audit = audit;
    }

    /** {@code GET /properties/{id}/verification} — the case file, thread included (S34). */
    @Transactional(readOnly = true)
    public PropertyReviewResponse get(AuthPrincipal actor, String propertyId) {
        Property property = participantProperty(actor, propertyId);
        boolean checker = mayReadNotes(actor);
        PropertyReview review = ownerVisibleCase(property, checker);
        return toResponse(review, property.getOwner().getId(), checker);
    }

    /**
     * This listing's case file, or {@code 404} if the caller is its owner and it holds nothing but
     * staff-only notes.
     *
     * <p><strong>Why the read routes need this and not just the note filter.</strong> A case file
     * that exists <em>only</em> because the duplicate probe fired is itself the answer to the
     * question the probe asks: submit a listing carrying a guessed meter number, then ask its case
     * file for anything at all — an empty {@code 200} means the meter is already on the platform.
     * Quieter than the note, and the same oracle.
     *
     * <p>Conditioned on the case being <em>only</em> internal and untouched: the moment a moderator
     * picks it up or decides it, there is something here that is genuinely the owner's business, and
     * they get it back.
     *
     * <p>The emptiness check is load-bearing, not defensive. An owner may open their own case file
     * with {@code POST /verification} before anything has been said in it, and {@code allMatch} over
     * no messages is vacuously true — without it, the owner is refused the case they just created.
     *
     * <p><strong>Read routes only.</strong> The write routes close the same oracle the opposite way,
     * by always succeeding; see {@link #addMessage}.
     *
     * @param checker whether the caller may read staff-only material — {@link #mayReadNotes}, not
     *                the bare role
     */
    private PropertyReview ownerVisibleCase(Property property, boolean checker) {
        PropertyReview review = requireCase(property);
        if (!checker && review.getReviewer() == null && review.getDecidedAt() == null
                && !review.getMessages().isEmpty()
                && review.getMessages().stream().allMatch(ReviewMessage::isInternal)) {
            throw new NotFoundException("No verification review for this listing");
        }
        return review;
    }

    /**
     * {@code GET /admin/property-reviews} — paged verification case queue for staff/admin.
     *
     * <p>The unread count is the owner's unanswered messages, which is what the desk is triaging by.
     * It is deliberately <em>not</em> "messages I personally have not read": the queue is shared, so
     * scoping the badge to the reader would make a colleague's reply look like new owner mail.
     */
    @Transactional(readOnly = true)
    public Page<PropertyReviewSummary> listCases(Pageable pageable) {
        Page<PropertyReview> page = reviews.findAllForDesk(pageable);
        Map<UUID, UUID> ownerByProperty = ownersOf(page.getContent());
        return page.map(review -> toSummary(review, ownerByProperty.get(review.getPropertyId()), true));
    }

    /**
     * {@code GET /me/property-reviews} — the same queue narrowed to the caller's own listings (D218).
     *
     * <p>Needs no role guard: it is scoped by {@code actor.userId()}, so a caller can only ever see
     * their own case files, and a user with no listings gets an empty page rather than a 403.
     *
     * <p>Here the unread count is the mirror image — <em>ops</em> messages the owner has not read,
     * which is the badge the dashboard card shows. Both counts fall out of the same rule, that a
     * message is unread to the side that did not send it, applied from opposite ends.
     */
    @Transactional(readOnly = true)
    public Page<PropertyReviewSummary> listMyCases(AuthPrincipal actor, Pageable pageable) {
        UUID ownerId = actor.userId();
        return reviews.findAllForOwner(ownerId, pageable)
                .map(review -> toSummary(review, ownerId, false));
    }

    /**
     * Owner id per case file, in one query for the whole page.
     *
     * <p>Resolved in bulk rather than per row because {@code toSummary} needs the owner only to
     * decide which side sent each message, and doing that lookup inside the {@code map} would be a
     * select per case file — the N+1 this method exists to avoid.
     */
    private Map<UUID, UUID> ownersOf(List<PropertyReview> page) {
        List<UUID> ids = page.stream().map(PropertyReview::getPropertyId).toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return properties.findAllById(ids).stream()
                .collect(Collectors.toMap(Property::getId, property -> property.getOwner().getId()));
    }

    /**
     * @param ownerId the listing's owner, or {@code null} if the listing has since been hard-deleted
     * @param forOps  {@code true} to count the owner's unread messages, {@code false} for ops'
     */
    private static PropertyReviewSummary toSummary(PropertyReview review, UUID ownerId, boolean forOps) {
        long unread = ownerId == null ? 0 : review.getMessages().stream()
                .filter(message -> message.getReadAt() == null)
                // An internal note counts for nobody. Not for the owner, who cannot see it — a badge
                // pointing at a message that is not in the thread is a bug report waiting to happen.
                // Not for ops either: the ops-side badge means "the owner is waiting on a reply", and
                // a note the platform wrote to itself is not somebody waiting.
                .filter(message -> !message.isInternal())
                .filter(message -> ownerId.equals(message.getSenderId()) == forOps)
                .count();
        return new PropertyReviewSummary(
                review.getPropertyId().toString(),
                review.getStatus(),
                review.getReviewer(),
                (int) unread,
                review.getDecidedAt(),
                review.getUpdatedAt());
    }

    /**
     * {@code POST /properties/{id}/verification} — submit the listing for review.
     *
     * <p>Idempotent: re-submitting an existing case returns it rather than creating a second one.
     * {@code property_reviews.property_id} is UNIQUE, so the alternative was a constraint violation
     * on a double-click.
     */
    @Transactional
    public PropertyReviewResponse initiate(AuthPrincipal actor, String propertyId) {
        Property property = participantProperty(actor, propertyId);
        return toResponse(cases.ensure(property.getId(), property.getDeal()),
                property.getOwner().getId(), mayReadNotes(actor));
    }

    /**
     * {@code POST /properties/{id}/verification/messages} — either participant posts.
     *
     * <p><strong>Opens the case rather than demanding one, and that is the security fix.</strong>
     * This used to {@code orElseThrow(404)} on the case file's absence, which made it a second copy
     * of the oracle the staff-only note exists to close: a case file is created by the duplicate
     * probe, so posting a message and reading the status told you whether your guessed meter number
     * was already on the platform — {@code 201} yes, {@code 404} no, two requests, no note ever
     * read. Refusing <em>both</em> cases would have closed it too, but at the price of letting any
     * attacker mute an honest owner's support thread by colliding with them on purpose. The
     * behaviour has to be identical either way; the version where the owner can still speak is the
     * one worth having.
     *
     * <p>{@link VerificationCases#ensure} is idempotent, so this is exactly what
     * {@code POST /verification} already does for a listing that has never been flagged. An owner
     * asking a question about a listing under suspicion is a conversation the ops desk wants.
     */
    @Transactional
    public PropertyReviewResponse addMessage(AuthPrincipal actor, String propertyId, String body) {
        if (body == null || body.isBlank()) {
            throw new BadRequestException("body is required");
        }
        Property property = participantProperty(actor, propertyId);
        boolean checker = mayReadNotes(actor);
        PropertyReview review = cases.ensure(property.getId(), property.getDeal());
        review.addMessage(actor.userId(), body.trim());
        // Flush before mapping. Both id and createdAt are assigned by Hibernate at insert time
        // (@UuidGenerator, @CreationTimestamp), so a response built from the freshly added instance
        // would carry nulls for the two fields the client needs to render and de-duplicate it.
        reviews.saveAndFlush(review);
        return toResponse(review, property.getOwner().getId(), checker);
    }

    /**
     * {@code POST /properties/{id}/verification/read} — mark the <em>other</em> side's messages read.
     *
     * <p>Only the other side's: marking your own messages read is meaningless, and doing it would
     * silently clear the unread badge the other participant is waiting on.
     *
     * <p>{@code 204} whether or not a case file exists, for the reason spelled out on
     * {@link #addMessage}: this route used to {@code 404} on its absence, and since the duplicate
     * probe is what creates one, that made a read receipt a one-request test for whether a guessed
     * meter number was already on the platform. Marking nothing read is the honest answer to
     * "nothing is unread", so there was never anything for the error to say.
     */
    @Transactional
    public void markRead(AuthPrincipal actor, String propertyId) {
        Property property = participantProperty(actor, propertyId);
        reviews.findByPropertyId(property.getId()).ifPresent(review -> review.getMessages().stream()
                .filter(message -> !actor.userId().equals(message.getSenderId()))
                .forEach(ReviewMessage::markRead));
    }

    /**
     * {@code POST /properties/{id}/verification/decision} — staff/admin only, the checker half.
     *
     * <p>Writes to <em>three</em> places, and each one answers a question the other two cannot. The
     * case file records who decided and why; {@code properties.status} decides whether the listing
     * is publicly visible (see {@link PropertyReview} for why these are not one column); and the
     * thread gets the sentence that tells the owner what happened. A decision that updated only the
     * first two would leave the owner watching a status flip with no explanation attached to it.
     */
    @Transactional
    public PropertyReviewResponse decide(AuthPrincipal actor, String propertyId, String decision,
            String note) {
        boolean approve = "approve".equals(decision);
        if (!approve && !"reject".equals(decision)) {
            throw new BadRequestException("decision must be approve or reject");
        }
        Property property = load(propertyId);
        if (actor.userId().equals(property.getOwner().getId())) {
            throw new ForbiddenException(
                    "You cannot decide the verification of your own listing");
        }
        PropertyReview review = requireCase(property);

        String status = approve ? PropertyStatus.APPROVED : PropertyStatus.REJECTED;
        review.decide(status, actor.userId().toString(), note);
        review.addMessage(actor.userId(), decisionMessage(approve, note));
        // The explicit save is load-bearing, and mutation-proved: drop it and this route answers
        // 500. The new message is a transient child of a managed collection, so relying on dirty
        // checking defers its persist to commit — long after toResponse below has read getId() off
        // it and found null. save() merges, the merge cascades, and the id and createdAt are
        // assigned in memory there and then. The flush on top is symmetry with initiate() and
        // addMessage(), which do the same thing for the same reason; it is not what saves this.
        reviews.saveAndFlush(review);
        property.setStatus(status);
        if (approve) {
            property.setFlagReason(null);
        }
        audit.record(actor, "property.verification.decision", "property", propertyId,
                "decision", decision, "note", note,
                "owner", String.valueOf(property.getOwner().getId()));
        return toResponse(review, property.getOwner().getId(), mayReadNotes(actor));
    }

    /**
     * {@code PATCH /properties/{id}/verification/checklist} — staff/admin only, tick or untick one
     * line (D218).
     *
     * <p>The line is addressed by its <em>text</em>, not by an id, and that is deliberate: the items
     * are seeded from a fixed per-deal list and {@code item} is {@code updatable = false}, so the
     * text is as stable as a surrogate key would be and survives a client that cached the case file.
     *
     * <p>Refuses the listing's own owner for the same reason {@link #decide} does, and the reason is
     * sharper here than it first looks. A staff member cannot approve their own listing, so ticking
     * it would be pointless theatre — except that the ticks are what the colleague who <em>can</em>
     * approve it reads before deciding. Letting an owner-reviewer mark their own documents inspected
     * launders self-interest into the record the checker relies on, which is worse than a decision
     * made with no checklist at all.
     *
     * @param item the checklist line's text, exactly as returned by {@link #get}
     * @param pass true once a reviewer has inspected the document and accepted it
     */
    @Transactional
    public PropertyReviewResponse setChecklistItem(AuthPrincipal actor, String propertyId, String item,
            boolean pass) {
        if (item == null || item.isBlank()) {
            throw new BadRequestException("item is required");
        }
        Property property = load(propertyId);
        if (actor.userId().equals(property.getOwner().getId())) {
            throw new ForbiddenException(
                    "You cannot check off the verification of your own listing");
        }
        PropertyReview review = requireCase(property);
        ReviewChecklistItem line = review.getChecklist().stream()
                .filter(entry -> entry.getItem().equals(item))
                .findFirst()
                .orElseThrow(() -> new NotFoundException("No such checklist item"));
        line.setPass(pass);
        return toResponse(review, property.getOwner().getId(), mayReadNotes(actor));
    }

    /**
     * The sentence a decision posts into the owner&lt;-&gt;ops thread.
     *
     * <p>Wording carried over verbatim from {@code lib/data/properties-admin.js#decideReview}, which
     * is where it used to be built — in the browser, after the fact, and never persisted. That copy
     * therefore existed only on the screen of the staff member who clicked the button: the owner,
     * fetching their own case file, saw {@code status} flip to {@code rejected} and no sentence
     * anywhere explaining it. Composing it here costs one row and makes the thread the complete
     * record of the decision, which is the only reading under which "reply here to resubmit" is a
     * true instruction.
     *
     * <p>It is stored English, not a translation key, and that is a real cost rather than an
     * oversight: a persisted string is frozen in the language it was written in, so an owner reading
     * in Marathi gets this line in English while the rest of the thread renders in their locale. The
     * alternative — emitting a key and interpolating client-side — puts the platform's own words
     * back in the browser, which is the arrangement that lost them in the first place. If this
     * becomes a problem the fix is a locale column on the message, not a retreat to client-side
     * composition.
     *
     * @param note the checker's free-text reason; blank falls back to a generic line, because an
     *             approval with no note is routine while a rejection with no note still owes the
     *             owner a reason
     */
    private static String decisionMessage(boolean approve, String note) {
        boolean explained = note != null && !note.isBlank();
        if (approve) {
            return "\u2705 Your property has been verified and approved."
                    + (explained ? " " + note.trim() : " It is now live on PuneNest.");
        }
        return "\u26D4 Your property could not be approved.\nReason: "
                + (explained ? note.trim() : "It did not meet our verification requirements.")
                + "\nPlease address this and reply here to resubmit.";
    }

    /** Load the listing and assert the caller is the owner or staff, else 404. */
    private Property participantProperty(AuthPrincipal actor, String propertyId) {
        Property property = load(propertyId);
        if (!isStaff(actor) && !actor.userId().equals(property.getOwner().getId())) {
            throw NotFoundException.of("Property");
        }
        return property;
    }

    private static boolean isStaff(AuthPrincipal actor) {
        return Roles.Wire.STAFF.equals(actor.role()) || Roles.Wire.ADMIN.equals(actor.role());
    }

    /**
     * Whether staff-only material renders for this caller.
     *
     * <p>The grant, not the role. Every other operation on this case file is gated on the role
     * <em>and</em> a {@code properties:read} or {@code properties:write} grant at the controller;
     * this route cannot be, because it is participant-or-staff — an owner has no grants and must
     * still reach their own thread. So the role test that used to stand in for "is a checker" let a
     * staff account whose {@code properties:read} had been deliberately revoked read every internal
     * note on every listing, through the one verification route with no {@code @PreAuthorize} on the
     * permission. Revoking a grant has to mean something, or it is theatre.
     *
     * <p>{@code properties:read} rather than {@code :write}, because reading the file is what this
     * decides; deciding the case is separately gated on {@code :write} at the controller.
     */
    private boolean mayReadNotes(AuthPrincipal actor) {
        return isStaff(actor) && permissions.granted(actor, BackOfficePermissions.PROPERTIES_READ);
    }

    /**
     * This listing's case file, or {@code 404} — the lookup all three case-file routes share.
     *
     * <p>Extracted so the 404 wording has one definition rather than three that can drift. It is
     * deliberately <em>not</em> where the owner-visibility check lives: that guard throws the same
     * exception for a different reason, and folding the two together would make a case that exists
     * and a case the caller may not see indistinguishable in the code, which is exactly the
     * distinction {@link #ownerVisibleCase} is drawing.
     */
    private PropertyReview requireCase(Property property) {
        return reviews.findByPropertyId(property.getId())
                .orElseThrow(() -> new NotFoundException("No verification review for this listing"));
    }

    private Property load(String propertyId) {
        return Ids.parseUuid(propertyId)
                .flatMap(properties::findById)
                .orElseThrow(() -> NotFoundException.of("Property"));
    }

    private static PropertyReviewResponse toResponse(PropertyReview review, UUID ownerId,
            boolean staff) {
        return new PropertyReviewResponse(
                review.getPropertyId().toString(),
                review.getStatus(),
                review.getReviewer(),
                review.getChecklist().stream()
                        .map(item -> new PropertyReviewResponse.ChecklistEntry(item.getItem(), item.isPass()))
                        .toList(),
                review.getMessages().stream()
                        // The one line that keeps the duplicate finding away from the person it is
                        // about (V80). It is a filter on the way out rather than a separate query so
                        // that there is exactly one place to get this wrong, and it is here.
                        .filter(message -> staff || !message.isInternal())
                        .map(message -> new PropertyReviewResponse.MessageEntry(
                                message.getId().toString(),
                                ownerId.equals(message.getSenderId()) ? "owner" : "ops",
                                message.getBody(),
                                message.getCreatedAt(),
                                message.getReadAt() != null,
                                message.isInternal()))
                        .toList(),
                review.getNotes(),
                review.getDecidedAt());
    }

    /** Paged queue shape for {@code /admin/property-reviews} and {@code /me/property-reviews}. */
    public record PropertyReviewSummary(
            String propertyId,
            String status,
            String reviewer,
            int unread,
            Instant decidedAt,
            Instant updatedAt) {
    }
}
