package com.draazy.api.catalog.city;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Capabilities;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The back office's two city surfaces: the launch toggle, and the demand behind it.
 *
 * <p><strong>The two methods are guarded differently, and the gap is the point.</strong> Taking a
 * city live is the same class of decision as editing the platform policy document (D192/D13), so
 * {@code PATCH} needs {@code settings:write} on top of the admin role and writes a
 * {@code city.update} audit row. Reading how many people asked for a city is a dashboard read, so
 * {@code GET} is staff-visible like {@link Routes.Admin#SUPPLY_GAP} — it renders on the same Supply
 * Gap tab, and an ops operator who can see the gap but not the waitlist gets a screen that
 * half-loads with no way to tell that from nobody having asked.
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
    private static final String DASHBOARD_READ =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')"
                    + " and " + Capabilities.REQUIRE_VIEW_DASHBOARD
                    + " and " + BackOfficePermissions.REQUIRE_DASHBOARD_READ;

    private final CityAdminService cities;

    public CityAdminController(CityAdminService cities) {
        this.cities = cities;
    }

    /**
     * {@code GET /admin/cities/waitlist} (contract {@code adminCityWaitlist}) — counts per city.
     *
     * <p>Takes no parameters at all. There is no {@code ?days=} because expansion demand does not
     * decay, and no paging because the row count is the number of distinct cities people have
     * named. Both absences are argued in {@link CityWaitlistRepository#demandByCity()}.
     */
    @GetMapping(Routes.Admin.CITY_WAITLIST)
    @PreAuthorize(DASHBOARD_READ)
    public List<CityWaitlistDemandRow> waitlist() {
        return cities.expansionDemand();
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

