package com.draazy.api.admin.staff;

/**
 * One bar of the per-entity split: a kind of record, and how many times it was acted on.
 *
 * @param entity the kind of record, e.g. {@code user}, {@code property}, {@code locality}
 * @param count  how many actions in the window touched it
 */
public record StaffActivityCount(String entity, long count) {
}
