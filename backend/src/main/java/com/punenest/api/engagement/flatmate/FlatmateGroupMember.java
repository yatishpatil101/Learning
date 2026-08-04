package com.punenest.api.engagement.flatmate;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One person in a {@link FlatmateGroup} (V27 {@code flatmate_group_members}).
 *
 * <p>A row per person rather than a jsonb array on the group, because a member is a person who may
 * later become a <em>user</em>: the array shape has nowhere to put a {@link #userId}, and every
 * "am I in this group?" question would become a scan of a document.
 *
 * <p>{@link #userId} is nullable on purpose. A group's creator names their existing flatmates before
 * those people have PuneNest accounts — a named-but-unregistered member is precisely the state the
 * product starts in, not an error to be validated away.
 */
@Entity
@Table(name = "flatmate_group_members")
@Getter
public class FlatmateGroupMember extends AuditedEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_id", nullable = false, updatable = false)
    private FlatmateGroup group;

    @Column(name = "user_id")
    @Setter
    private UUID userId;

    @Column(name = "name", nullable = false)
    @Setter
    private String name;

    /**
     * Stored rather than derived from {@link #name}: a person may go by initials that are not the
     * first letters of the name on their account, and the card renders this directly.
     */
    @Column(name = "initials")
    @Setter
    private String initials;

    @Column(name = "verified", nullable = false)
    @Setter
    private boolean verified = false;

    protected FlatmateGroupMember() {
    }

    FlatmateGroupMember(String name, UUID userId, boolean verified) {
        this.name = name;
        this.userId = userId;
        this.verified = verified;
        this.initials = initialsOf(name);
    }

    /** Set by {@link FlatmateGroup#addMember} so both sides of the association stay consistent. */
    void attachTo(FlatmateGroup owner) {
        this.group = owner;
    }

    /**
     * First letters of the first two words, upper-cased. A fallback for when the client sends none —
     * not a rule, since {@link #initials} is settable precisely so a person can override it.
     */
    static String initialsOf(String name) {
        if (name == null || name.isBlank()) {
            return null;
        }
        String[] words = name.strip().split("\\s+");
        StringBuilder out = new StringBuilder(2);
        for (String word : words) {
            if (out.length() == 2) {
                break;
            }
            if (!word.isEmpty()) {
                out.append(Character.toUpperCase(word.charAt(0)));
            }
        }
        return out.isEmpty() ? null : out.toString();
    }
}
