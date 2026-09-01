package com.punenest.api.common.trust;

import java.util.UUID;

/**
 * How many chasers a thing has had, as a lookup the response mapper can consult.
 *
 * <p>Exists because the count belongs to the outreach ledger and the field that renders it belongs
 * to the listing response, and neither package should have to learn about the other. The mapper
 * takes one of these as context; whoever is answering the request decides what it knows.
 *
 * <h2>Why a lookup rather than a number</h2>
 *
 * <p>The first caller maps a page of moderation rows. Handing the mapper a single count would mean
 * asking for it per row, which is one query per card — the same shape of mistake that made the
 * console's KPI numbers wrong, arriving from the other direction. A lookup is filled once from a
 * grouped query before the page is mapped, so the cost is one statement regardless of page size.
 *
 * <p>{@link #NONE} is the honest answer for every surface that has not loaded the ledger, and it is
 * the value all seven consumer-facing call sites pass. It reads as zero, which is also what those
 * responses would show — but they never show it, because the whole back-office projection is absent
 * for them. The constant is there so a caller states that it is not answering this question, rather
 * than passing null and having the mapper guess.
 */
@FunctionalInterface
public interface OutreachCounts {

    /** Nothing has been loaded; every subject reports zero. */
    OutreachCounts NONE = subject -> 0;

    /** How many outbound messages have been prepared about {@code subjectId}. */
    int forSubject(UUID subjectId);
}
