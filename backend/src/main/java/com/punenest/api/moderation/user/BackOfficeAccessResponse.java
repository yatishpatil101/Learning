package com.punenest.api.moderation.user;

import java.util.List;

/**
 * One back-office account's access, as the Team &amp; Access console needs to render it
 * (tech debt D192/D13).
 *
 * <p><strong>{@code permissions} and {@code effective} are both here on purpose.</strong> The first
 * is what is stored, the second is what the server will actually honour after intersecting it with
 * the account's role baseline. They differ whenever a document names something the role cannot hold
 * — and a screen that echoed only the input could not show that, which is how an administrator ends
 * up believing they granted something. Showing the outcome beside the input is the difference
 * between a control and a form.
 *
 * @param role        the account's wire role; the ceiling {@code effective} was computed against
 * @param scoped      whether a document exists at all. Distinct from an empty {@code permissions}:
 *                    no document means "unscoped, the role baseline applies", an empty one means
 *                    "deliberately allowed nothing"
 * @param permissions exactly what is stored, unfiltered. Empty if the row is unreadable, in which
 *                    case {@code effective} is empty too — see {@code BackOfficeAccessService}
 * @param effective   what this account may actually do right now
 */
public record BackOfficeAccessResponse(
        String userId,
        String role,
        boolean scoped,
        List<String> permissions,
        List<String> effective) {
}
