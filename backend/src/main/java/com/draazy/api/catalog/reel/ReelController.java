package com.draazy.api.catalog.reel;

import com.draazy.api.common.web.Routes;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /reels} — the short-video discovery feed. Public ({@code security: []}).
 *
 * <p><strong>Paged input, unpaged output — and that is the contract, not an oversight.</strong> The
 * operation declares {@code page} and {@code size} but its response schema is a bare array rather
 * than a {@code PageEnvelope}. That combination is right for an infinite-scroll feed: the client
 * needs to ask for the next slice, but a total count of every reel ever published is a number no
 * feed displays and an expensive one to compute. So the parameters bound the read and the response
 * stays a list.
 *
 * <p>No service layer: there is no decision between the repository and the wire beyond which of two
 * finders to call.
 */
@RestController
public class ReelController {

    private final ReelRepository reels;
    private final ReelMapper reelMapper;

    public ReelController(ReelRepository reels, ReelMapper reelMapper) {
        this.reels = reels;
        this.reelMapper = reelMapper;
    }

    /**
     * {@code GET /reels} — newest first, optionally narrowed to one locality.
     *
     * <p>{@code size} is capped globally at the contract's 100
     * ({@code spring.data.web.pageable.max-page-size}), so an anonymous caller cannot ask for the
     * whole table in one request.
     *
     * <p><strong>{@code locality} is a slug, not a display name.</strong> The filter keys on
     * {@code reels.locality_slug} — the same locality vocabulary every other surface sends — so a
     * caller passes {@code koregaon-park}, not {@code Koregaon Park}. The reel's caption keeps the
     * display label; only the filter moved to the slug.
     *
     * <p><strong>The client's sort is discarded, not sanitized.</strong> The contract declares no
     * {@code sort} parameter here — a feed's order is the feed's own — but Spring binds one anyway
     * from any {@code ?sort=} it sees and would append it to the derived query, where an unknown
     * property becomes a 500 on a public endpoint. A whitelist would be the answer if sorting were
     * offered; since it is not, the honest fix is to page without a sort at all and let the
     * repository's {@code OrderBy} stand.
     */
    @GetMapping(Routes.Reels.BASE)
    @Transactional(readOnly = true)
    public List<ReelResponse> list(
            @RequestParam(required = false) String locality,
            @PageableDefault(size = 20) Pageable pageable) {
        Pageable slice = PageRequest.of(pageable.getPageNumber(), pageable.getPageSize());
        List<Reel> page = (locality == null || locality.isBlank())
                ? reels.findAllByOrderByCreatedAtDesc(slice)
                : reels.findByLocalitySlugIgnoreCaseOrderByCreatedAtDesc(locality.trim(), slice);
        return page.stream().map(reelMapper::toResponse).toList();
    }
}
