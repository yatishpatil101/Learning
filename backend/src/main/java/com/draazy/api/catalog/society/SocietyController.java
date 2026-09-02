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
    private final SocietyMintService mintService;

    public SocietyController(SocietyService societyService, SocietyMintService mintService) {
        this.societyService = societyService;
        this.mintService = mintService;
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

    /**
     * {@code POST /societies} — add a society the catalogue does not have. Authenticated.
     *
     * <p>Answers <strong>201</strong> for a new society and <strong>200</strong> when the name
     * already matches one, handing back the canonical row in both cases. The distinction is not
     * cosmetic: it is what lets the screen say "Added" or "Already on Draazy", and collapsing it
     * would tell somebody they had just added a society that has existed for two years.
     *
     * <p>Signing in is required, and not as a formality. The row records who added it, which is what
     * an operator reviewing the queue needs in order to ask, and what makes one account minting
     * fifty societies visible rather than merely suspected.
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
