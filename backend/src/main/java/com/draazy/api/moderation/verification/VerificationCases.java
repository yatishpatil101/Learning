package com.draazy.api.moderation.verification;

import com.draazy.api.common.trust.ListingCaseNotes;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Opens verification case files, and is the one way anything outside this slice puts a sentence in
 * front of a listing's owner (D218).
 *
 * <p><strong>Why this exists as its own collaborator.</strong> Two things that happen during a
 * listing write — a material edit earning a re-review, and a submission colliding with another
 * owner's listing — are facts the owner and the ops desk both need, and the owner/ops verification
 * thread is the only place on this platform where those two people can see the same record. Before
 * this, both were composed in the browser and written to localStorage: the re-review explanation
 * existed only on the owner's machine, the duplicate warning only on the machine that triggered it,
 * and ops — the only people who can act on either — never saw one.
 *
 * <p>Narrow on purpose, and reached through {@link ListingCaseNotes} rather than by name. The
 * listing write needs to <em>say something</em>, not to run verifications, so it gets a two-method
 * port in the shared kernel rather than this whole service — which is also what keeps the direction
 * of the coupling legal, since {@code catalog} may not import {@code moderation} (see the port's
 * own note).
 *
 * <p><strong>System notes carry no sender.</strong> {@code review_messages.sender_id} is nullable
 * and the wire's {@code from} is derived by comparing it to the listing owner, so a null sender
 * renders as {@code "ops"} — which is what these are: the platform speaking, not a named colleague.
 * Attributing one to the editing owner would be a lie in the other direction, and would also make
 * the message count as already read from the owner's side, so their dashboard badge would never
 * light up for the one message that needed them to look.
 */
@Service
public class VerificationCases implements ListingCaseNotes {

    /**
     * The checklist a new case starts with. A rental is a lighter check than a sale because the risk
     * is lighter: a bad tenancy costs a deposit, a bad sale costs a house.
     */
    private static final List<String> RENT_CHECKLIST = List.of(
            "Index II", "Electricity bill", "Aadhaar card");

    private static final List<String> BUY_CHECKLIST = List.of(
            "Ownership proof (Sale deed / Index II)",
            "Property tax receipt",
            "Owner government ID (Aadhaar / PAN)",
            "Society NOC / Maintenance receipt",
            "Encumbrance certificate",
            "Listing photos match the property");

    private static final String DEAL_RENT = "rent";

    private final PropertyReviewRepository reviews;

    public VerificationCases(PropertyReviewRepository reviews) {
        this.reviews = reviews;
    }

    /**
     * This listing's case file, created with its opening checklist if it has never had one.
     *
     * <p>Idempotent, which is the whole reason it is a method: {@code property_reviews.property_id}
     * is UNIQUE, so "create one if absent" written twice is a constraint violation waiting for a
     * double-click.
     *
     * <p><strong>Idempotent when called twice at once, and not only twice in a row.</strong> The
     * plain {@code find().orElseGet(insert)} it used to be was only the second kind: two
     * transactions both read no row, both inserted, and one of them was handed
     * {@code duplicate key value violates unique constraint} — a moderator told the database
     * rejected their write, for opening a listing a colleague opened in the same second. The
     * advisory lock closes the window, and the second read inside it is what makes the lock worth
     * taking: whoever loses the race finds the winner's row rather than inserting into it.
     *
     * <p>Read first and lock second, rather than lock first. Every call after the first one in a
     * listing's life takes the fast path and never touches the lock at all, which matters because
     * this runs on every open of the review modal for the rest of that listing's existence. The
     * cost of the double-checked shape is the one extra read paid once, by the caller who is about
     * to insert anyway.
     *
     * <p>{@code MANDATORY} rather than {@code REQUIRED}: every caller is already inside a write
     * transaction, and a case file that commits independently of the listing write that justified it
     * is a work item pointing at a change that never happened. It is also what makes the lock's
     * lifetime meaningful — {@code pg_advisory_xact_lock} is released by the caller's commit, so a
     * method that opened its own transaction would drop the lock before the row it protects was
     * visible to anybody.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public PropertyReview ensure(UUID propertyId, String deal) {
        Optional<PropertyReview> existing = reviews.findByPropertyId(propertyId);
        if (existing.isPresent()) {
            return existing.get();
        }
        reviews.lockCaseFileFor(propertyId);
        return reviews.findByPropertyId(propertyId).orElseGet(() -> {
            PropertyReview created = new PropertyReview(propertyId);
            checklistFor(deal).forEach(created::addChecklistItem);
            // saveAndFlush, not save: the checklist items are transient until insert. Nothing in the
            // response reads their generated fields today, which makes plain save correct only by
            // coincidence — and the coincidence breaks the moment a checklist entry gains an id.
            return reviews.saveAndFlush(created);
        });
    }

    /**
     * Post a platform-authored note into this listing's verification thread, opening the case file
     * if the listing has never had one.
     *
     * <p>Opening one is the point rather than a side effect. A listing that went live months ago and
     * has just been materially edited, or a submission that has just collided with somebody else's,
     * both need a moderator to look at them — and a case file <em>is</em> the work item the ops queue
     * reads. A note with nowhere to land would be a warning nobody receives.
     *
     * <p>The {@code MANDATORY} annotation has to stay on <em>this</em> method and not only on
     * {@link #ensure}: the call below is a self-invocation, which does not go through the proxy, so
     * {@code ensure}'s own propagation setting is inert on this path. Removing it here on the
     * grounds that {@code ensure} already declares it would silently drop the guarantee.
     */
    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void post(UUID propertyId, String deal, String body) {
        write(propertyId, deal, body, false);
    }

    /**
     * The staff-only half — the owner's copy of the thread does not contain it (V80), and a case
     * file holding nothing else does not exist as far as they are concerned.
     *
     * <p>For findings that are <em>about</em> the submitter rather than <em>for</em> them. The
     * duplicate probe is the case that forced this to exist: its note names the other listing, and
     * an owner who can read it can use their own thread to test whether a guessed meter number or
     * address is already on the platform — including against listings still pending, which no public
     * route will confirm exist.
     *
     * <p>The re-post guard is not decoration. The probe re-runs on every edit that moves one of its
     * inputs, so an owner correcting a typo in a colliding address would otherwise file the same
     * finding once per keystroke-sized save.
     */
    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void postInternalOnce(UUID propertyId, String deal, String body) {
        PropertyReview review = ensure(propertyId, deal);
        boolean alreadySaid = review.getMessages().stream()
                .anyMatch(message -> message.isInternal() && message.getBody().equals(body));
        if (!alreadySaid) {
            write(propertyId, deal, body, true);
        }
    }

    private void write(UUID propertyId, String deal, String body, boolean internal) {
        PropertyReview review = ensure(propertyId, deal);
        if (internal) {
            review.addInternalNote(body);
        } else {
            review.addMessage(null, body);
        }
        // saveAndFlush for the reason spelled out on PropertyVerificationService.decide: a new
        // message is a transient child of a managed collection, and deferring its persist to commit
        // leaves its generated id and timestamp null for anything reading the thread in the same
        // transaction.
        reviews.saveAndFlush(review);
    }

    private static List<String> checklistFor(String deal) {
        return DEAL_RENT.equals(deal) ? RENT_CHECKLIST : BUY_CHECKLIST;
    }
}
