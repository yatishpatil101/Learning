package com.punenest.api.engagement.messaging;

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
 * A piece of reusable outreach copy — the wording of a chaser, not the chaser itself.
 *
 * <p>These were a frozen array in the browser bundle, which made rewording a reminder a frontend
 * deploy. They are operational copy: the people who know whether "Is it still available?" earns
 * replies are the desk staff reading them, and they should not need a release to act on it.
 *
 * <p><strong>The id is the slug, not a uuid.</strong> Templates are referred to by name in code, in
 * audit rows and out loud ("send them wa-aadhaar"), and a surrogate key would turn every one of
 * those into an indirection with nothing to gain. The slugs are the ones the console already used,
 * so prior habits and any existing audit trail keep meaning what they meant.
 */
@Entity
@Table(name = "message_template")
@Getter
public class MessageTemplate {

    /**
     * Matches {@code {owner_name}} and friends. Deliberately {@code \w+} rather than anything
     * richer: a placeholder language with defaults, formatting or conditionals is a template engine,
     * and a template engine editable from an admin screen is a way to execute strings.
     */
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
     * Substitute {@code {placeholder}} keys from {@code variables}.
     *
     * <p><strong>An unknown key is left standing, not blanked.</strong> Blanking is the tempting
     * default and it is the wrong one here: a typo'd {@code {owner_nme}} would quietly delete the
     * owner's name from the greeting, and nobody reviewing the preview would notice an absence. Left
     * as literal text it is impossible to miss, and the staff member reads this text before pressing
     * send — so the loud failure lands in front of the one person able to fix it.
     *
     * <p>A null value is treated the same as a missing key, because "we have no phone number for
     * this owner" and "nobody passed one" produce the same broken sentence.
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
