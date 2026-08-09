package com.punenest.api.services.request;

import java.time.Instant;

/**
 * Contract schema {@code Message}.
 *
 * @param authorId   who wrote it — <strong>the field a client must use to decide "mine or theirs"</strong>.
 *     {@link #author} is a display name, and attributing by name works right up until two users
 *     share one, at which point a stranger's message renders on the reader's own side of the thread.
 *     Added 2026-08-08: the mapper already read this id to look up the name and then discarded it,
 *     so the contract declared a field the wire never carried (found by {@code SpecSchemaParityTest}).
 * @param author     display name; {@code null} for a message whose author has since been removed
 * @param authorRole {@code buyer|owner|staff|admin}, captured at write time
 */
public record MessageDto(
        String id,
        String authorId,
        String author,
        String authorRole,
        String body,
        Instant createdAt) {
}
