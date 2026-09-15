package com.draazy.api.engagement.messaging;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.Getter;

/**
 * Reusable outreach copy (the wording of a chaser, not the chaser itself). Slugged, not uuid-keyed,
 * so referring to a template by name in code and audit rows stays a direct reference.
 */
@Entity
@Table(name = "message_template")
@Getter
public class MessageTemplate {

    /** Matches {@code {key}}. {@code \w+} only — richer syntax becomes an admin-editable engine. */
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{(\\w+)}");

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "channel", nullable = false)
    private String channel;

    @Column(name = "category", nullable = false)
    private String category;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "body", nullable = false)
    private String body;

    @Column(name = "active", nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected MessageTemplate() {}

    /**
     * Substitute {@code {placeholder}} keys from {@code variables}. Unknown or null keys stay as
     * literal text so a typo lands loudly in the preview rather than silently blanking the sentence.
     */
    public String render(Map<String, String> variables) {
        Matcher matcher = PLACEHOLDER.matcher(body);
        StringBuilder out = new StringBuilder();
        while (matcher.find()) {
            String value = variables.get(matcher.group(1));
            matcher.appendReplacement(out, Matcher.quoteReplacement(value != null ? value : matcher.group()));
        }
        matcher.appendTail(out);
        return out.toString();
    }
}
