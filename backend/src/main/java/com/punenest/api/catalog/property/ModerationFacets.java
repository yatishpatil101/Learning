package com.punenest.api.catalog.property;

/**
 * The moderation-only half of the property search — the axes {@link PropertySearchQuery} does not
 * carry because the public catalogue has no way to express them and no business expressing them.
 *
 * <p><strong>Why a record rather than five more arguments.</strong> These arrived one at a time:
 * {@code archived}, then {@code recheck}, then the three added when the admin console's queues
 * moved off the browser. As positional parameters that is
 * {@code searchForModeration(filters, archived, recheck, featured, postedByAdmin, unconfirmed, page)}
 * — six consecutive {@code Boolean}s, every pair of which transposes without a compile error and
 * without a test failing, because each one on its own returns a plausible page of listings. The
 * failure would be a queue quietly showing the wrong rows, which is the exact class of defect this
 * whole change exists to remove. Named components make the transposition unrepresentable.
 *
 * <p><strong>Every component is tri-state and every {@code null} means "do not filter".</strong>
 * That is not the same as a two-valued flag defaulting to false: "show me everything" and "show me
 * only the ones that are not X" are different questions, and a boolean can only ask the second. An
 * unfiltered moderation read returns every listing at every status including archived, because
 * that is what a queue is.
 *
 * @param archived {@code true} = archived only, {@code false} = live only, {@code null} = both.
 * @param recheck the stays-live re-check queue (Q14) — listings whose owner changed a buyer-facing
 *     detail after approval and which are waiting for a moderator <em>while still approved and
 *     still in search</em>. A third axis rather than a {@code status} value precisely because every
 *     status except {@code approved} is off search, so expressing it as a status would re-impose
 *     the cost the split exists to avoid.
 * @param featured the curated shelf. A column rather than a derived property, so it filters here
 *     rather than in the browser — which is what it did until the Featured tab was measured
 *     rendering <em>zero</em> listings on a catalogue holding five, because all five were older
 *     than the hundred rows the console had fetched.
 * @param postedByAdmin listings the concierge desk created on an owner's behalf. Backed by the
 *     {@code posted_by_admin} column and not by {@code adminPipeline->>'postedByStaff'}, which is
 *     the staff member's id inside a jsonb blob: the two are written together by
 *     {@code markPostedOnBehalf}, the column is indexable, and a queue should not depend on the
 *     shape of a free-form map.
 * @param unconfirmed listings whose owner has gone quiet — {@link Freshness#STALE} or
 *     {@link Freshness#DORMANT}, i.e. no confirmation of availability for longer than
 *     {@link Freshness#AGING_DAYS} days. The boundary is {@link Freshness#unconfirmedBefore} rather
 *     than a literal interval in a specification, so the SQL and the enum cannot drift apart; a
 *     test pins the two together. Note this is a <em>freshness</em> axis and not a status one: the
 *     listings it returns are approved, un-archived and live in search, earning impressions on a
 *     promise of availability nobody has renewed.
 */
public record ModerationFacets(
        Boolean archived,
        Boolean recheck,
        Boolean featured,
        Boolean postedByAdmin,
        Boolean unconfirmed) {

    /** Filter on nothing: every listing at every status, archived included. */
    public static final ModerationFacets NONE = new ModerationFacets(null, null, null, null, null);

    /** True when no axis is set, so the caller wants the whole table. */
    public boolean isEmpty() {
        return archived == null && recheck == null && featured == null
                && postedByAdmin == null && unconfirmed == null;
    }
}
