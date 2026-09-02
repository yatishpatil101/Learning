package com.draazy.api.leads.society;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.persistence.RateLimitLock;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AuthPrincipal;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The B2B pipeline: public capture, staff-only reading and working.
 *
 * <p>The asymmetry is the design. Anyone may file a lead — a society secretary is not a user and
 * will not create an account to ask a question — but only ops may read one, because the list is a
 * pile of names and phone numbers belonging to people who never agreed to be on the platform.
 */
@Service
public class SocietyLeadService {

    /** What the contract's {@code interest} enum permits. */
    private static final Set<String> INTERESTS =
            Set.of("bulk-listing", "society-services", "partnership");

    /**
     * Public-submit budget: how many leads one number may file in {@link #RATE_WINDOW}.
     *
     * <p>Three rather than one, because a genuine builder with three societies fills the form three
     * times in a sitting and a limit of one would look exactly like a bug to them. High enough to
     * be invisible to a real user, low enough that a script cannot fill the ops queue with noise.
     */
    private static final int MAX_SUBMISSIONS = 3;

    private static final Duration RATE_WINDOW = Duration.ofHours(1);

    private final SocietyLeadRepository leads;
    private final AuditService audit;
    /** Makes the per-mobile budget check atomic with the insert it guards (D73). */
    private final RateLimitLock locks;

    public SocietyLeadService(SocietyLeadRepository leads, AuditService audit,
            RateLimitLock locks) {
        this.leads = leads;
        this.audit = audit;
        this.locks = locks;
    }

    /** {@code GET /society-leads} — the pipeline, newest first, optionally one column. */
    @Transactional(readOnly = true)
    public Page<SocietyLeadDto> pipeline(String status, Pageable pageable) {
        if (status != null && !status.isBlank() && !SocietyLeadStatuses.isValid(status)) {
            // why 400 and not an empty page: an unknown status is a client bug, and silently
            // returning nothing makes it look like an empty pipeline instead.
            throw new BadRequestException("Unknown lead status: " + status);
        }
        String filter = (status == null || status.isBlank()) ? null : status;
        return leads.pipeline(filter, pageable).map(SocietyLeadDto::from);
    }

    /**
     * {@code POST /society-leads} — public, unauthenticated capture.
     *
     * <p>Rate-limited per mobile against the table itself rather than an in-memory counter: this
     * endpoint has no session to hang a bucket off, and a counter that resets on deploy is not a
     * limit. The index {@code idx_society_leads_mobile_created} exists for exactly this query.
     *
     * <p><strong>And serialised per mobile before the count, because counting against a table is
     * only a limit if nobody can insert between the count and the insert</strong> (D73). This is the
     * platform's only unauthenticated write, so the burst that defeats it costs an attacker nothing
     * to arrange: with two leads already filed, three concurrent posts all read two, all find room
     * under a cap of three, and the ops queue takes five. The lock is held to commit, so the second
     * caller's count includes the first caller's row.
     */
    @Transactional
    public SocietyLeadDto submit(SocietyLeadCreateRequest request) {
        String interest = request.interest();
        if (interest != null && !interest.isBlank() && !INTERESTS.contains(interest)) {
            throw new BadRequestException("Unknown interest: " + interest);
        }
        // @IndianMobile validated the shape; canonicalise once so the rate-limit lookup and the
        // stored row key off the same ten digits.
        String mobile = MobileMask.normalise(request.mobile());
        locks.holdUntilCommit(RateLimitLock.Limit.SOCIETY_LEAD_SUBMIT, mobile);
        long recent = leads.countByMobileAndCreatedAtAfter(
                mobile, Instant.now().minus(RATE_WINDOW));
        if (recent >= MAX_SUBMISSIONS) {
            throw new RateLimitedException(
                    "Too many enquiries from this number — we will call you back shortly",
                    (int) RATE_WINDOW.toSeconds());
        }
        SocietyLead lead = leads.save(new SocietyLead(request.societyName().strip(),
                request.contactName().strip(), mobile, request.units(),
                blankToNull(interest)));
        return SocietyLeadDto.from(lead);
    }

    /**
     * {@code PATCH /society-leads/{id}} — move a lead along the pipeline.
     *
     * <p>Audited even though nothing here touches money: this is the only record that a named
     * staff member decided a builder was not worth calling back, and "who marked it lost" is the
     * first question asked when a deal that should have happened did not.
     */
    @Transactional
    public SocietyLeadDto update(AuthPrincipal caller, String id, String status, String note) {
        if (!SocietyLeadStatuses.isValid(status)) {
            throw new BadRequestException("Unknown lead status: " + status);
        }
        SocietyLead lead = Ids.parseUuid(id)
                .flatMap(leads::findById)
                .orElseThrow(() -> NotFoundException.of("Society lead"));
        String previous = lead.getStatus();
        lead.moveTo(status, note);
        audit.record(caller, "societyLead.update", "societyLead", lead.getId().toString(),
                "from", previous, "to", status);
        return SocietyLeadDto.from(lead);
    }

    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value;
    }
}
