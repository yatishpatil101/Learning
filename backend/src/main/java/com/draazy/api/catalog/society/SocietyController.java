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

/**
 * {@code /societies} - the public society directory and hub, caller-aware so a signed-in reader gets
 * {@code followedByMe} while an anonymous one gets {@code false} (docs/flows/consumer/societies.md 9.6).
 */
@RestController
public class SocietyController {

    private final SocietyService societyService;
    private final SocietyMintService mintService;

    public SocietyController(SocietyService societyService, SocietyMintService mintService) {
        this.societyService = societyService;
        this.mintService = mintService;
    }

    /**
     * {@code GET /societies} - paged directory; {@code sort} is clamped to {@link SocietySort}'s
     * whitelist and {@code hasListings=true} narrows to societies with a live listing.
     */
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

    /**
     * {@code POST /societies} - add a society the catalogue lacks. <strong>201 for a new row, 200
     * when the name already matches one</strong>, so the screen can tell the two apart (societies.md 9.6).
     */
    @PostMapping(Routes.Societies.BASE)
    public ResponseEntity<SocietyResponse> mint(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody SocietyMintRequest request) {
        SocietyMintService.MintedSociety result = mintService.mint(request, principal.userId());
        return ResponseEntity
                .status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(result.society());
    }

    /** Null for an anonymous reader — which is a legitimate state here, not a failure. */
    private static UUID viewerId(AuthPrincipal principal) {
        return principal != null ? principal.userId() : null;
    }
}
