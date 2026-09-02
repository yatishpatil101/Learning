package com.draazy.api.engagement.demand;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code POST /demand-signals} — the one write. There is no read here on purpose.
 *
 * <p><strong>Why unauthenticated.</strong> The two highest-volume kinds fire on public surfaces: a
 * search on {@code /listings} and a property view. Requiring a session would restrict the demand
 * report to people who already signed up, which inverts its purpose — the gap worth knowing about
 * is the one that made a visitor leave. {@code SecurityConfig} opens this route POST-only and
 * exact-path, and {@code WriteRateLimitFilter} caps it per IP like every other mutating route.
 *
 * <p><strong>Why there is no GET.</strong> Read access lives on {@code /admin/supply-gap} behind the
 * back-office guards. A public read here would let anyone enumerate what the platform is short of,
 * locality by locality, which is a competitor's market-research budget handed over for free — and
 * the reason it is not merely "an aggregate so it is harmless" is that the aggregate <em>is</em> the
 * valuable artefact. Writing without being able to read back is the correct asymmetry for telemetry.
 *
 * <p><strong>Why 202 and an empty body.</strong> The caller is a page doing something else — the
 * search results it is rendering do not depend on this having landed, and the id of the row is of no
 * use to anybody. Returning the created entity would invite a client to believe it owns the record.
 */
@RestController
public class DemandSignalController {

    private final DemandSignalService service;

    public DemandSignalController(DemandSignalService service) {
        this.service = service;
    }

    /** {@code POST /demand-signals} (contract {@code recordDemandSignal}). */
    @PostMapping(Routes.DemandSignals.BASE)
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void record(@Valid @RequestBody DemandSignalCreate body,
                       @CurrentUser AuthPrincipal principal) {
        service.record(body, principal);
    }
}
