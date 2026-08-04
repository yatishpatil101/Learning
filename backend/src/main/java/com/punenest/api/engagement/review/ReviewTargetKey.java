package com.punenest.api.engagement.review;

import com.punenest.api.catalog.locality.LocalityRepository;
import com.punenest.api.catalog.society.SocietyRepository;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.UserRepository;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Resolves the {@code entityId} a client sends into the one canonical {@code reviews.target_id} the
 * platform stores for that kind of target.
 *
 * <p><strong>This settles a question slice 7 explicitly left open.</strong>
 * {@code SocietyDetailResponse} documents that its rating aggregate was left null because "nothing
 * has yet decided whether a society review keys on the society's id or its slug", and computing an
 * aggregate against a guessed key would produce a number that looks authoritative and silently
 * becomes wrong. This class is that decision, and it is what unblocks the aggregate.
 *
 * <p>The rule is: <em>accept whatever public identifier the caller already holds; store the key the
 * rest of the schema uses for that thing.</em> The contract supports this directly — it describes
 * {@code entityId} as "Slug or id of the target entity" — and it avoids the two obvious failure
 * modes. Storing the slug for a society would orphan every review the day a society is renamed;
 * demanding the id would force the client, which navigated to {@code /societies/{slug}} and has only
 * a slug, into an extra round-trip.
 *
 * <p>So, per kind:
 * <ul>
 *   <li><strong>society</strong> → its UUID. Immutable, and the key {@code properties.society_id}
 *       and the follower aggregates already join on.</li>
 *   <li><strong>locality</strong> → its slug. Not a compromise: {@code localities.slug} <em>is</em>
 *       the primary key, and {@code properties.locality_slug} is the foreign key to it.</li>
 *   <li><strong>owner</strong> → the user's UUID.</li>
 *   <li><strong>property</strong> → the listing's UUID (handled on the property route).</li>
 * </ul>
 *
 * <p>Resolution doubles as existence checking, which is the point: without it, a typo in a slug
 * writes a review attached to nothing, discoverable by no one, and counted in no aggregate.
 */
@Component
public class ReviewTargetKey {

    private final SocietyRepository societies;
    private final LocalityRepository localities;
    private final UserRepository users;

    public ReviewTargetKey(SocietyRepository societies, LocalityRepository localities,
            UserRepository users) {
        this.societies = societies;
        this.localities = localities;
        this.users = users;
    }

    /**
     * Resolve one {@code (entityType, entityId)} pair to its canonical stored key.
     *
     * @param entityType one of {@code society}, {@code locality}, {@code owner}
     * @param entityId   the slug or id the client holds
     * @return the canonical {@code target_id} to store and query on
     * @throws NotFoundException if the type is not an entity target, or nothing of that kind exists
     *                           under that identifier
     */
    public String resolve(String entityType, String entityId) {
        if (!ReviewTargetTypes.isEntityTarget(entityType)) {
            throw new NotFoundException("Unknown review target type '" + entityType + "'");
        }
        return switch (entityType) {
            case ReviewTargetTypes.SOCIETY -> societies.findBySlug(entityId)
                    .map(s -> s.getId().toString())
                    .orElseGet(() -> societyById(entityId));
            case ReviewTargetTypes.LOCALITY -> localities.findById(entityId)
                    .map(l -> l.getSlug())
                    .orElseThrow(() -> NotFoundException.of("Locality"));
            case ReviewTargetTypes.OWNER -> users.findById(uuid(entityId, "Owner"))
                    .map(u -> u.getId().toString())
                    .orElseThrow(() -> NotFoundException.of("Owner"));
            default -> throw new NotFoundException("Unknown review target type '" + entityType + "'");
        };
    }

    /**
     * Societies are addressable by slug or by id, so a slug miss falls through to an id lookup
     * rather than 404-ing a caller who legitimately held the id.
     */
    private String societyById(String raw) {
        return societies.findById(uuid(raw, "Society"))
                .map(s -> s.getId().toString())
                .orElseThrow(() -> NotFoundException.of("Society"));
    }

    /**
     * A malformed UUID is a 404, not a 400. The caller asked for a thing that does not exist; which
     * of the two reasons it does not exist is not information they are owed, and answering
     * differently would let an attacker distinguish "wrong shape" from "right shape, no such row".
     *
     * <p>That posture only holds if the two answers are byte-for-byte identical, which is why this
     * goes through {@link NotFoundException#of} rather than composing its own sentence: the miss
     * below and the miss at the call site must produce the same message, and they used to not
     * (tech-debt D35).
     *
     * @param kind the resource as the caller would name it, capitalised — it reaches the wire
     */
    private static UUID uuid(String raw, String kind) {
        return Ids.parseUuid(raw)
                .orElseThrow(() -> NotFoundException.of(kind));
    }
}
