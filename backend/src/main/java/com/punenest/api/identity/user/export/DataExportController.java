package com.punenest.api.identity.user.export;

import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /me/data-export} — the DPDP right of access and data portability.
 *
 * <p>The counterpart to {@code /me/erasure}. That endpoint destroys the subject's personal data on
 * request; this one shows it to them. They are two halves of the same statutory scheme — Digital
 * Personal Data Protection Act 2023 s.11 (access) and s.12 (erasure) — and the platform cannot
 * credibly offer the second without the first: a right to delete data you were never allowed to see
 * is a right to delete something you have to take on trust exists.
 *
 * <p><strong>Authenticated, and nothing more.</strong> No role, no capability, no ops involvement.
 * The right belongs to the subject, and putting a queue between a person and their own data would
 * turn an entitlement into a favour — the same argument {@code ErasureController} makes about
 * filing an erasure request, and it is if anything stronger here, because access is a pure read that
 * destroys nothing and so has no irreversibility to justify a gate.
 *
 * <p><strong>There is no parameter.</strong> Not a path variable, not a query string, not a body.
 * The subject is taken from the authenticated principal and there is no syntax in which a caller can
 * name somebody else. This is worth stating explicitly because the obvious generalisation — {@code
 * GET /admin/users/{id}/data-export}, for support staff answering an access request on the phone —
 * would be a single-request exfiltration of an arbitrary person's entire history, and the value of
 * an endpoint that cannot express that request is that it cannot be misused, misconfigured, or
 * reached by a token that leaked. If ops ever need to serve an access request on a subject's behalf,
 * that should be a separate, admin-guarded, audit-logged endpoint whose design starts from the
 * assumption that it will be abused.
 *
 * <p><strong>Rate limited as a write.</strong> Registered in {@code WriteRateLimitFilter} despite
 * being a {@code GET}: it is by a wide margin the most expensive read on the platform — roughly
 * seventy queries across the whole schema per call — and the ordinary defence against expensive
 * reads, caching, is not available to a document that must be a live point-in-time statement. See
 * that filter's register for the reasoning.
 *
 * <p>Route constant declared here rather than in {@code common.web.Routes}, matching {@code
 * ErasureController} — the same deviation, recorded for the same reason, and the two should move
 * together.
 */
@RestController
public class DataExportController {

    /**
     * {@code GET} — the subject's own data export.
     *
     * <p>Public rather than package-private, unlike {@code ErasureController}'s constants, because
     * {@code WriteRateLimitFilter} names this path and a test in the security package asserts the
     * two agree. A rename that broke that agreement would fail the rate limit open, silently.
     */
    public static final String ME_DATA_EXPORT = "/me/data-export";

    private final DataExportService service;

    DataExportController(DataExportService service) {
        this.service = service;
    }

    /**
     * Returns everything the platform holds about the caller, grouped by domain, with the second
     * party to any shared record reduced to a reference and an explicit list of what was left out.
     *
     * <p>A single JSON document rather than a streamed archive of files. The row cap in {@link
     * DataExportService} is what makes that safe, and a document a person can open, read and search
     * in a browser is worth a great deal more to them than a zip they have to be shown how to
     * unpack — portability is only a right if the thing you are handed is usable.
     */
    @GetMapping(ME_DATA_EXPORT)
    public DataExportResponse export(@CurrentUser AuthPrincipal principal) {
        return service.exportFor(principal.userId());
    }
}
