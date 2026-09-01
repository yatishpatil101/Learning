package com.punenest.api.catalog.city;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code PATCH /admin/cities/{slug}} — the back-office's launch toggle for one curated city.
 *
 * <p>Guarded by {@code settings:write} on top of the admin role (D192/D13): taking a city live is
 * the same class of decision as editing the platform policy document, and an administrator narrowed
 * by {@code BackOfficeAccessService} should not be able to do one without the other. Every call
 * writes a {@code city.update} audit row.
 *
 * <p>{@code slug} is the primary key, not a display name, so it is matched exactly —
 * {@code /admin/cities/Mumbai} is a 404 and {@code /admin/cities/mumbai} is the city. Normalising
 * it here would invent a second spelling for a key the roster already publishes in {@code GET
 * /cities}.
 */
@RestController
public class CityAdminController {

    private static final String ADMIN_ONLY = "hasRole('" + Roles.ADMIN + "')";
    private static final String SETTINGS_WRITE =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_SETTINGS_WRITE;

    private final CityAdminService cities;

    public CityAdminController(CityAdminService cities) {
        this.cities = cities;
    }

    /** Launch or pause one city. The roster is curated; only the live bit is mutable. */
    @PatchMapping(Routes.Admin.CITY_BY_SLUG)
    @PreAuthorize(SETTINGS_WRITE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void update(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug,
            @Valid @RequestBody CityAdminUpdateRequest request) {
        cities.updateLive(slug, request, principal);
    }
}

