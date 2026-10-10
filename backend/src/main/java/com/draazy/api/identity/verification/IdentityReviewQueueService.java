package com.draazy.api.identity.verification;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.AuthPrincipal;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IdentityReviewQueueService {

    static final String QA = "qa";
    static final String DECIDED = "decided";

    static final Duration OVERDUE_AFTER = Duration.ofHours(48);

    private static final List<String> DECIDED_STATUSES = List.of(
            VerificationStatuses.VERIFIED, VerificationStatuses.REJECTED, VerificationStatuses.REVOKED);
    private static final Set<String> CLAIMS = Set.of("mine", "unclaimed", "others");
    private static final Set<String> SORTS = Set.of("oldest", "newest");
    private static final char ESCAPE = '\\';

    public record Filters(String status, String q, String docType, String claim, boolean overdue,
            String outcome, String sort) {
    }

    public record Summary(long pending, long overdue, long mine, long qa, long decided) {
    }

    private final IdentityVerificationRepository verifications;
    private final IdentityReviewReadService read;
    private final Clock clock;

    public IdentityReviewQueueService(IdentityVerificationRepository verifications,
            IdentityReviewReadService read, Clock clock) {
        this.verifications = verifications;
        this.read = read;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Page<IdentityReviewRow> queue(AuthPrincipal actor, Filters f, Pageable pageable) {
        validate(f);
        Pageable ordered = PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), order(f));
        return read.toRowPage(actor, verifications.findAll(spec(actor, f), ordered));
    }

    @Transactional(readOnly = true)
    public Summary summary(AuthPrincipal actor) {
        Instant now = Instant.now(clock);
        UUID me = actor == null ? new UUID(0, 0) : actor.userId();
        var c = verifications.summaryCounts(now.minus(OVERDUE_AFTER), now.minus(IdentityReviewClaimService.CLAIM_TTL), me);
        return new Summary(c.getPending(), c.getOverdue(), c.getMine(), c.getQa(), c.getDecided());
    }

    private static void validate(Filters f) {
        if (f.claim() != null && !CLAIMS.contains(f.claim())) {
            throw new BadRequestException("claim must be one of " + CLAIMS);
        }
        if (f.sort() != null && !SORTS.contains(f.sort())) {
            throw new BadRequestException("sort must be oldest or newest");
        }
        if (f.docType() != null && !IdentityDocTypes.ALL.contains(f.docType())) {
            throw new BadRequestException("docType must be one of " + IdentityDocTypes.ALL);
        }
        if (f.outcome() != null && !DECIDED_STATUSES.contains(f.outcome())) {
            throw new BadRequestException("outcome must be one of " + DECIDED_STATUSES);
        }
    }

    private Specification<IdentityVerification> spec(AuthPrincipal actor, Filters f) {
        Specification<IdentityVerification> base = switch (f.status() == null ? "" : f.status()) {
            case "" -> Specification.not(statusIs(VerificationStatuses.WITHDRAWN));
            case QA -> qaOpen(actor);
            case DECIDED -> decided(f.outcome());
            default -> statusIs(f.status());
        };
        if (f.docType() != null) {
            base = base.and((root, query, cb) -> cb.equal(root.get("docType"), f.docType()));
        }
        if (f.claim() != null) {
            base = base.and(claim(actor, f.claim()));
        }
        if (f.overdue()) {
            base = base.and(overdue());
        }
        String q = f.q() == null ? "" : f.q().trim();
        return q.isEmpty() ? base : base.and(applicantMatches(q));
    }

    private static Sort order(Filters f) {
        String status = f.status() == null ? "" : f.status();
        String column = switch (status) {
            case VerificationStatuses.PENDING, "" -> "submittedAt";
            case QA -> "qaSampledAt";
            default -> "decidedAt";
        };
        boolean oldestByDefault = VerificationStatuses.PENDING.equals(status) || QA.equals(status);
        boolean oldest = f.sort() == null ? oldestByDefault : "oldest".equals(f.sort());
        Sort.Direction dir = oldest ? Sort.Direction.ASC : Sort.Direction.DESC;
        return Sort.by(new Sort.Order(dir, column).nullsLast(), new Sort.Order(dir, "id"));
    }

    private static Specification<IdentityVerification> statusIs(String status) {
        return (root, query, cb) -> cb.equal(root.get("status"), status);
    }

    private static Specification<IdentityVerification> decided(String outcome) {
        return outcome == null
                ? (root, query, cb) -> root.get("status").in(DECIDED_STATUSES)
                : statusIs(outcome);
    }

    private static Specification<IdentityVerification> qaOpen(AuthPrincipal actor) {
        UUID me = actor == null ? null : actor.userId();
        return (root, query, cb) -> cb.and(
                cb.equal(root.get("status"), VerificationStatuses.VERIFIED),
                cb.isNotNull(root.get("qaSampledAt")),
                cb.isNull(root.get("qaReviewedAt")),
                me == null
                        ? cb.conjunction()
                        : cb.or(cb.isNull(root.get("reviewerId")), cb.notEqual(root.get("reviewerId"), me)));
    }

    private Specification<IdentityVerification> overdue() {
        Instant cutoff = Instant.now(clock).minus(OVERDUE_AFTER);
        return (root, query, cb) -> cb.lessThan(root.get("submittedAt"), cutoff);
    }

    private Specification<IdentityVerification> claim(AuthPrincipal actor, String which) {
        Instant fresh = Instant.now(clock).minus(IdentityReviewClaimService.CLAIM_TTL);
        UUID me = actor == null ? null : actor.userId();
        return (root, query, cb) -> {
            var held = cb.and(cb.isNotNull(root.get("claimedBy")), cb.greaterThan(root.get("claimedAt"), fresh));
            return switch (which) {
                case "mine" -> me == null ? cb.disjunction() : cb.and(held, cb.equal(root.get("claimedBy"), me));
                case "others" -> me == null ? held : cb.and(held, cb.notEqual(root.get("claimedBy"), me));
                default -> cb.not(held);
            };
        };
    }

    private static Specification<IdentityVerification> applicantMatches(String q) {
        String digits = q.replaceAll("\\D", "");
        String namePattern = "%" + escapeLike(q.toLowerCase(Locale.ROOT)) + "%";
        return (root, query, cb) -> {
            Subquery<UUID> users = query.subquery(UUID.class);
            Root<User> u = users.from(User.class);
            var byName = cb.like(cb.lower(u.get("name")), namePattern, ESCAPE);
            users.select(u.get("id")).where(digits.length() >= 3
                    ? cb.or(byName, cb.like(u.get("mobile"), "%" + digits + "%"))
                    : byName);
            return root.get("userId").in(users);
        };
    }

    private static String escapeLike(String s) {
        return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
