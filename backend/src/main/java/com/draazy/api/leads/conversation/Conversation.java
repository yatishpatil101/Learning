package com.draazy.api.leads.conversation;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * One in-app chat thread between two people, optionally about a listing. Maps
 * {@code conversations} (V4, reshaped by V22).
 *
 * <p><strong>The pair is canonically ordered: {@code userAId} always sorts first.</strong>
 * A conversation is a relationship, not a direction — "Asha's thread with Rohit" and "Rohit's
 * thread with Asha" are one fact. V4 stored the pair unordered, so nothing stopped both rows
 * existing, and two rows for one relationship is the worst failure this feature has: each party
 * replies into their own copy, both see a thread, and neither sees the other's messages. Ordering
 * the pair makes the duplicate unrepresentable rather than merely unlikely — the V22 CHECK refuses
 * the flipped row and the unique index refuses the second one. "Sorts first" means
 * {@link #ordersFirst}, which is deliberately not {@code UUID.compareTo}.
 *
 * <p>A consequence worth knowing when reading this class: {@code userAId} carries no meaning. It is
 * not the initiator and not the owner; whoever has the smaller uuid is A. Ask {@link #other(UUID)}
 * and {@link #involves(UUID)} rather than either column directly.
 *
 * <p>{@code lastMessage} is denormalised so the inbox renders without joining the thread. It is a
 * preview, updated on every send.
 */
@Entity
@Table(name = "conversations")
@Getter
public class Conversation extends AuditedEntity {

    @Column(name = "user_a_id", nullable = false, updatable = false)
    private UUID userAId;

    @Column(name = "user_b_id", nullable = false, updatable = false)
    private UUID userBId;

    @Column(name = "property_id", updatable = false)
    private UUID propertyId;

    @Column(name = "last_message")
    private String lastMessage;

    protected Conversation() {
        // JPA
    }

    /**
     * Open a thread between two people. The arguments are in no particular order — the constructor
     * canonicalises them, so callers cannot get it wrong by passing "me" first out of habit.
     *
     * @throws IllegalArgumentException if the two ids are equal; a conversation with oneself is
     *                                  refused here as well as by the V4 CHECK, because reaching
     *                                  the database with it means a check upstream already failed
     */
    Conversation(UUID oneUser, UUID otherUser, UUID propertyId, String lastMessage) {
        if (oneUser.equals(otherUser)) {
            throw new IllegalArgumentException("a conversation needs two different people");
        }
        boolean ordered = ordersFirst(oneUser, otherUser);
        this.userAId = ordered ? oneUser : otherUser;
        this.userBId = ordered ? otherUser : oneUser;
        this.propertyId = propertyId;
        this.lastMessage = lastMessage;
    }

    /**
     * Whether {@code a} sorts before {@code b} <em>the way Postgres sorts uuids</em>.
     *
     * <p><strong>Not {@code a.compareTo(b)}.</strong> {@link UUID#compareTo} compares the two halves
     * as <em>signed</em> longs, so any uuid whose first hex digit is 8-f counts as negative and sorts
     * before everything else; Postgres compares the 16 bytes unsigned. The two orderings disagree on
     * about half of all pairs, which means a canonicalisation done with {@code compareTo} produces
     * rows the V22 CHECK rejects — and rejects only sometimes, which is worse than always.
     *
     * <p>Comparing the canonical lower-case hex strings is order-isomorphic to Postgres's byte
     * comparison, so this and the constraint agree by construction. Both the constructor and the
     * find-or-create probe go through here so they cannot drift apart.
     */
    static boolean ordersFirst(UUID a, UUID b) {
        return a.toString().compareTo(b.toString()) < 0;
    }

    /** The participant who is not {@code me}. */
    public UUID other(UUID me) {
        return userAId.equals(me) ? userBId : userAId;
    }

    public boolean involves(UUID userId) {
        return userAId.equals(userId) || userBId.equals(userId);
    }

    /** The lower of the two ids, by Postgres uuid order. Carries no domain meaning — see the class note. */
    /**
     * Package-private: the preview is a consequence of sending a message, never something a caller
     * sets on its own. {@code ConversationService} keeps it in step with the thread.
     */
    void setLastMessage(String lastMessage) {
        this.lastMessage = lastMessage;
    }
}
