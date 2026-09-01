package com.punenest.api.content;

import java.time.Instant;
import java.util.Map;

/**
 * Contract schema {@code ContentItemWrite} — the create/update payload for any of the four CMS
 * lists (spec fix S55).
 *
 * <p>Every field is nullable because the applicable set depends on the {@code {type}} path
 * parameter, which OpenAPI cannot express. Two consequences, both deliberate:
 *
 * <ul>
 *   <li>On <strong>PATCH</strong>, {@code null} means "leave this alone". A CMS row is edited one
 *       field at a time from a form that only renders the fields for its type, so replace semantics
 *       would blank everything the open form did not happen to show.
 *   <li>On <strong>POST</strong>, the per-type required fields are checked by
 *       {@link AdminContentService} and answered as a 422 naming the field, rather than being left
 *       to the database's not-null constraint and a 409.
 * </ul>
 *
 * <p>The cost of this shape is that a field belonging to another type is silently ignored rather
 * than rejected — sending {@code position} to an FAQ does nothing. Accepted: the alternative is
 * four write schemas and a discriminator restating what the URL already says.
 *
 * <p><strong>{@code translations} is the one field that belongs to every type (D2)</strong>, which
 * is why it sits on its own below rather than under one of the four headings. It is replaced whole,
 * not merged: the editor screen renders every language it knows about at once, so a PATCH that
 * merged would leave a deleted translation undeletable — there would be no way to say "this row is
 * no longer translated into Marathi". Sending {@code null} still means "leave the whole map alone",
 * consistent with every other field here; sending {@code {}} is how a language is removed.
 */
public record ContentWrite(
        // announcements
        String title,
        String body,
        String severity,
        Instant startsAt,
        Instant endsAt,
        Boolean active,
        // services
        String name,
        String icon,
        String description,
        String link,
        // faqs
        String question,
        String answer,
        String category,
        // banners
        String image,
        String headline,
        Integer position,
        // all four
        Map<String, Map<String, String>> translations) {
}
