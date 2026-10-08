package com.draazy.api.catalog.society;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Caller-aware: signed-in readers get {@code followedByMe}, anonymous ones {@code false} (societies.md 9.6). */
@RestController
public class SocietyController {

    private final SocietyService societyService;
    private final SocietyMintService mintService;
    private final SocietyResolveService resolveService;

    public SocietyController(SocietyService societyService, SocietyMintService mintService,
            SocietyResolveService resolveService) {
        this.societyService = societyService;
        this.mintService = mintService;
        this.resolveService = resolveService;
    }

    /** {@code sort} is clamped to {@link SocietySort}'s whitelist;
     *  {@code hasListings=true} narrows to societies with a live listing. */
    @GetMapping(Routes.Societies.BASE)
    public PageResponse<SocietyResponse> browse(
            @CurrentUser AuthPrincipal principal,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String locality,
            @RequestParam(required = false) Boolean hasListings,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                societyService.browse(q, locality, hasListings, pageable, viewerId(principal)),
                Function.identity());
    }

    /** {@code GET /societies/{slug}} — one society hub; 404 if no such society. */
    @GetMapping(Routes.Societies.BY_SLUG)
    public SocietyDetailResponse get(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug) {
        return societyService.get(slug, viewerId(principal));
    }

    /** {@code GET /societies/resolve}: the place's society, or similar ones within 250 m; anonymous-readable like the directory. */
    @GetMapping(Routes.Societies.RESOLVE)
    public SocietyResolveResponse resolve(@CurrentUser AuthPrincipal principal,
            @RequestParam String placeId,
            @RequestParam(required = false) String name,
            @RequestParam(required = false) Double lat,
            @RequestParam(required = false) Double lng) {
        return resolveService.resolve(placeId, name, lat, lng, viewerId(principal));
    }

    /** {@code POST /societies}: 201 for a new row, 200 when the place already has one, so the screen can tell them apart. */
    @PostMapping(Routes.Societies.BASE)
    public ResponseEntity<SocietyResponse> mint(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody SocietyMintRequest request) {
        SocietyMintService.MintedSociety result = mintService.mint(request, principal);
        return ResponseEntity
                .status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(result.society());
    }

    /** Null for an anonymous reader — which is a legitimate state here, not a failure. */
    private static UUID viewerId(AuthPrincipal principal) {
        return principal != null ? principal.userId() : null;
    }
}
