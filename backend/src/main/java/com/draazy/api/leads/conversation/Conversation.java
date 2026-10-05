package com.draazy.api.leads.conversation;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

@Entity
@Table(name = "conversations")
@Getter
public class Conversation extends AuditedEntity {

    @Column(name = "user_a_id", updatable = false)
    private UUID userAId;

    @Column(name = "user_b_id", updatable = false)
    private UUID userBId;

    @Column(name = "flatmate_group_id", updatable = false)
    private UUID flatmateGroupId;

    @Column(name = "property_id", updatable = false)
    private UUID propertyId;

    @Column(name = "last_message")
    private String lastMessage;

    protected Conversation() {

    }

    // Constructor canonicalises parties, so caller argument order cannot matter.
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

    static boolean ordersFirst(UUID a, UUID b) {
        return a.toString().compareTo(b.toString()) < 0;
    }

    public UUID other(UUID me) {
        if (isGroup()) {
            return null;
        }
        return userAId.equals(me) ? userBId : userAId;
    }

    public boolean involves(UUID userId) {
        return !isGroup() && (userAId.equals(userId) || userBId.equals(userId));
    }

    public boolean isGroup() {
        return flatmateGroupId != null;
    }

    // The lower of the two ids, by Postgres uuid order.
    void setLastMessage(String lastMessage) {
        this.lastMessage = lastMessage;
    }
    }
