package com.punenest.api.moderation.note;

import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Ids;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Collapses the two identifiers a listing answers to into the one key a note is stored under.
 *
 * <h2>The bug this exists to make impossible</h2>
 *
 * <p>{@code entity_id} is {@code text} and was stored exactly as the client sent it. A listing has
 * two public identifiers — its slug ({@code p5145}) and its uuid — and the contract accepts either
 * on every {@code /properties/{id}} route, so both were arriving here. The console's note widget
 * sends the slug, because the client's {@code propertyMapper} sets a listing's seam {@code id} to
 * {@code slug || uuid}; {@code AdminEnquiries} sends the uuid, because an enquiry row carries
 * {@code propertyId} straight off the wire.
 *
 * <p>The result was two case files for one listing, and <strong>no error on either side</strong>.
 * Each writer read back precisely what it had written, so both surfaces looked correct and neither
 * could notice: the "responded to enquiry" note was filed against a key the review modal's timeline
 * never queried, and simply was not there — which reads exactly like nobody wrote one. That is the
 * same failure {@code V90} was created to end, one layer down.
 *
 * <p>Fixing the one call site would have fixed one call site. This is the {@code ReviewTargetKey}
 * rule applied to notes — <em>accept whatever public identifier the caller already holds; store the
 * key the rest of the schema uses for that thing</em> — so a future caller cannot reintroduce it by
 * passing the other one.
 *
 * <h2>Why an unresolvable id is stored as given rather than refused</h2>
 *
 * <p>{@code InternalNoteService} deliberately does not resolve a note's target against its table,
 * and {@code V90} says why: {@code entity_id} is not a foreign key because "a note about a listing
 * that is archived an hour later is precisely the note worth keeping". Existence-checking here
 * would quietly overturn that decision.
 *
 * <p>So this normalises and never rejects. A uuid is kept as-is without a query; a slug that
 * resolves becomes its uuid; anything else is stored verbatim, exactly as it was before this class
 * existed. Archived listings resolve — {@code findBySlug} carries no {@code archived} filter — which
 * matters, because a note taken as a listing is archived is the case the guarantee is about, and
 * resolving it any other way would split the bucket at the one moment it must not.
 *
 * <p>The other three kinds have no second spelling: {@code user}, {@code review} and {@code report}
 * are addressed by uuid alone. They pass through untouched rather than through a lookup that could
 * only ever return what it was given.
 */
@Component
public class NoteEntityKey {

    private final PropertyRepository properties;

    public NoteEntityKey(PropertyRepository properties) {
        this.properties = properties;
    }

    /**
     * The key to read and write a note under, for a caller holding either of a listing's ids.
     *
     * <p>Callers pass the raw path segment. The type is assumed already validated by
     * {@code NoteEntityTypes}; an unknown one is simply not a property and falls through.
     *
     * @param entityType one of the four note kinds, in the wire's vocabulary ({@code property}, not
     *                   {@code listing})
     * @param entityId   the slug or uuid the caller holds
     * @return the canonical key — never {@code null}, and never an exception for a miss
     */
    public String resolve(String entityType, String entityId) {
        if (!NoteEntityTypes.PROPERTY.equals(entityType) || entityId == null) {
            return entityId;
        }
        if (Ids.parseUuid(entityId).isPresent()) {
            return entityId;
        }
        return properties.findBySlug(entityId)
                .map(property -> property.getId())
                .map(UUID::toString)
                .orElse(entityId);
    }
}
