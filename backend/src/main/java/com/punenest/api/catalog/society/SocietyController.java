package com.punenest.api.catalog.society;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /societies} — the society directory and hub. Public ({@code security: []}).
 *
 * <p><strong>Public, yet caller-aware.</strong> {@code followedByMe} needs to know who is asking on
 * an endpoint that does not require anyone to be asking. {@code permitAll} does not reject a valid
 * bearer token, so the JWT filter still populates the context when one is present: a signed-in reader
 * gets their follow state, an anonymous one gets {@code false}, and neither is turned away. This is
 * the same pattern {@code PropertyController#get} uses for the contact gate.
 */
@RestController
public class SocietyController {

    private final SocietyService societyService;

    public SocietyController(SocietyService societyService) {
        this.societyService = societyService;
    }

    /**
     * {@code GET /societies} — paged directory, optionally filtered by free text and locality.
     *
     * <p>{@code sort} is clamped to {@link SocietySort}'s whitelist and {@code size} to the
     * contract's 100.
     */
    @GetMapping(Routes.Societies.BASE)
    public PageResponse<SocietyResponse> browse(
            @CurrentUser AuthPrincipal principal,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String locality,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                societyService.browse(q, locality, pageable, viewerId(principal)),
                Function.identity());
    }

    /** {@code GET /societies/{slug}} — one society hub; 404 if no such society. */
    @GetMapping(Routes.Societies.BY_SLUG)
    public SocietyDetailResponse get(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug) {
        return societyService.get(slug, viewerId(principal));
    }

    /** Null for an anonymous reader — which is a legitimate state here, not a failure. */
    private static UUID viewerId(AuthPrincipal principal) {
        return principal != null ? principal.userId() : null;
    }
}
