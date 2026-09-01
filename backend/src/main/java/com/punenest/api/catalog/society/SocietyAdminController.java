package com.punenest.api.catalog.society;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /admin/societies/{slug}} — ops correcting a society's own facts.
 *
 * <p>The last of the society console's surfaces to be answered out of the operator's own browser,
 * and the one whose browser-locality cost the most. The five queues beside it were each empty or
 * divergent; this form was neither — it reported success every time and changed nothing, on the four
 * fields a buyer reads to judge whether a building's paperwork is in order.
 *
 * <p>Guarded by the same {@code societies:read} / {@code societies:write} atoms as the candidates,
 * claims, proposals, residents and merges desks, for the reason given there: an operator who can
 * verify a member-added society can already vouch for its facts, and a sixth atom would leave every
 * existing ops account unable to finish a job it already does.
 */
@RestController
public class SocietyAdminController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    private static final String SOCIETIES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_SOCIETIES_WRITE;

    private static final String SOCIETIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_SOCIETIES_READ;

    private final SocietyAdminService societies;

    public SocietyAdminController(SocietyAdminService societies) {
        this.societies = societies;
    }

    /**
     * {@code GET /admin/societies/{slug}} — one society as the editor needs it. 404 if no such row.
     *
     * <p>Exists because of {@code adminNote}, and only because of it. The other four fields are on
     * {@code SocietyResponse} and the console could read them off the directory row it already has;
     * the note is not, and deliberately — it is moderator prose about a named building, often about
     * the people in it, and putting it on the anonymous directory payload to save a request is
     * exactly the accident {@link SocietyAdminResponse} exists to prevent. Without this route the
     * note is write-only: an operator saves it, reopens the form, and finds it blank.
     *
     * <p>Guarded on {@code societies:read} rather than {@code societies:write}, so the desk's
     * read-only operators can see the note that explains why a society was left as it is. That is
     * the note's whole purpose — it is addressed to the next person to open this form.
     */
    @GetMapping(Routes.AdminSocieties.BY_SLUG)
    @PreAuthorize(SOCIETIES_READ)
    public SocietyAdminResponse get(@PathVariable String slug) {
        return societies.get(slug);
    }

    /**
     * {@code PATCH /admin/societies/{slug}} — correct one society's facts. 404 if no such society.
     *
     * <p><strong>{@code PATCH}, not {@code PUT}</strong>, and the body means it: an absent field is
     * left alone rather than blanked. The console does send all five together today, but the row has
     * two dozen columns the form has never shown, and a {@code PUT} on a partial representation is
     * how those get erased by the next screen that reuses this route.
     *
     * <p><strong>Addressed by slug</strong>, like every other society route. The slug is this
     * system's public alias for a building — it is what a reader's URL carries and what the merge
     * and candidate desks already take — and the id is an internal join key that appears on no
     * screen an operator can read a value off.
     */
    @PatchMapping(Routes.AdminSocieties.BY_SLUG)
    @PreAuthorize(SOCIETIES_WRITE)
    public SocietyAdminResponse edit(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug,
            @Valid @RequestBody SocietyAdminEditRequest request) {
        return societies.edit(slug, request, principal);
    }
}
