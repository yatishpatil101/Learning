package com.punenest.api.common.error;

/**
 * 404 — a requested resource does not exist (or is archived, or belongs to someone else and is
 * therefore invisible to this caller).
 *
 * <p><strong>Prefer {@link #of(String)} to the constructor.</strong> Almost every 404 on the
 * platform says the same thing in the same shape — "Property not found", "Visit not found" — and
 * before the factory existed each of those strings was typed out by hand at every throw site. Eighty
 * hand-written copies of one sentence is eighty chances to write "No such property" instead, which
 * is what had already happened in two places by the time this was added (tech-debt D35). The factory
 * makes the common case impossible to get wrong and leaves the constructor for the ones that
 * genuinely need to say more.
 *
 * <p><strong>When to keep the constructor.</strong> When the extra words tell the caller something
 * they could act on — {@code "No such staff member to assign"} distinguishes a bad assignee id from
 * a bad ticket id on the same request, which the generic form cannot. A bespoke message is a
 * decision; a bespoke message that only rephrases the generic one is drift.
 *
 * <p>The message reaches the client verbatim as the {@code message} field of the error body, so it
 * must never name anything the caller is not already entitled to know. Naming the resource
 * <em>type</em> is safe — the caller chose the endpoint — but the id is not appended: on a
 * scoped-by-lookup surface a 404 and a 403 are deliberately the same answer, and echoing the id back
 * confirms the shape of the thing being probed for.
 */
public class NotFoundException extends ApiException {

    public NotFoundException(String message) {
        super(ErrorCodes.NOT_FOUND, 404, message);
    }

    /**
     * The standard 404 for a named resource: {@code of("Property")} produces
     * {@code "Property not found"}.
     *
     * @param resource the resource as the caller would name it, capitalised — {@code "Property"},
     *                 {@code "Visit"}, {@code "Tenant profile"}. Not a class name and not a table
     *                 name: this string is on the wire.
     */
    public static NotFoundException of(String resource) {
        return new NotFoundException(resource + " not found");
    }
}
