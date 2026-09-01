package com.punenest.api.leads.society;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Society / builder B2B leads (contract tag {@code Admin &amp; Analytics}).
 *
 * <p>Two of the three operations are staff-only; the submit is deliberately public
 * ({@code security: []} in the contract) and is the platform's only unauthenticated write of
 * free text, so it carries its own rate limit rather than relying on an authenticated identity.
 */
@RestController
public class SocietyLeadsController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    /** Seeing the B2B pipeline. */
    private static final String SOCIETIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_SOCIETIES_READ;

    /**
     * Moving a lead through it.
     *
     * <p>Not on {@link #submit}, which is the public form a society secretary fills in: it has no
     * authenticated caller to resolve a document for, and an atom there would close the funnel.
     */
    private static final String SOCIETIES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_SOCIETIES_WRITE;

    private final SocietyLeadService service;

    public SocietyLeadsController(SocietyLeadService service) {
        this.service = service;
    }

    /** {@code GET /society-leads} (contract {@code listSocietyLeads}) — paged since S57. */
    @GetMapping(Routes.SocietyLeads.BASE)
    @PreAuthorize(SOCIETIES_READ)
    public PageResponse<SocietyLeadDto> list(@RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                service.pipeline(status, Pageables.unsorted(pageable)), dto -> dto);
    }

    /** {@code POST /society-leads} (contract {@code createSocietyLead}) — public. */
    @PostMapping(Routes.SocietyLeads.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public SocietyLeadDto submit(@Valid @RequestBody SocietyLeadCreateRequest body) {
        return service.submit(body);
    }

    /** {@code PATCH /society-leads/{id}} (contract {@code updateSocietyLead}). */
    @PatchMapping(Routes.SocietyLeads.BY_ID)
    @PreAuthorize(SOCIETIES_WRITE)
    public SocietyLeadDto update(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody StatusUpdateRequest body) {
        return service.update(principal, id, body.status(), body.note());
    }

    /** Contract schema {@code StatusUpdate}. */
    public record StatusUpdateRequest(@NotBlank String status, @Size(max = 500) String note) {
    }
}
