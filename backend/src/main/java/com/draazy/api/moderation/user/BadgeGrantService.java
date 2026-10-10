package com.draazy.api.moderation.user;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.trust.OwnerBadgeSink;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.verification.IdentityVerificationService;
import com.draazy.api.security.AuthPrincipal;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class BadgeGrantService {

    private final BadgeGrantRequestRepository requests;
    private final UserRepository users;
    private final BackOfficeUserView view;
    private final AuditService audit;
    private final OwnerBadgeSink ownerBadges;
    private final IdentityVerificationService identity;

    BadgeGrantService(BadgeGrantRequestRepository requests, UserRepository users,
            BackOfficeUserView view, AuditService audit, OwnerBadgeSink ownerBadges,
            IdentityVerificationService identity) {
        this.requests = requests;
        this.users = users;
        this.view = view;
        this.audit = audit;
        this.ownerBadges = ownerBadges;
        this.identity = identity;
    }

    @Transactional
    BadgeGrantResponse request(AuthPrincipal actor, String id, String reason) {
        User user = view.load(id);
        String trimmedReason = validReason(reason, "reason");
        if (actor.userId().equals(user.getId())) {
            throw new ForbiddenException("You cannot request a Verified badge for your own account");
        }
        if (user.isVerified()) {
            throw new ConflictException("This user is already verified");
        }
        refusePending(user.getId(),
                "This user already has a pending badge grant request. Approve or reject it first.");
        BadgeGrantRequest saved = savePending(user, actor.userId(), trimmedReason);
        audit.record(actor, "user.badge.grant_requested", "badge_grant_request",
                saved.getId().toString(), "userId", user.getId().toString(), "reason", trimmedReason);
        return response(saved);
    }

    @Transactional
    AdminUserRow withdraw(AuthPrincipal actor, String id, String reason) {
        User user = view.load(id);
        refusePending(user.getId(),
                "This user has a pending badge grant request. Reject the pending request instead.");
        if (identity.isVerified(user.getId())) {
            throw new ConflictException(
                    "This badge was earned through identity verification and cannot be withdrawn "
                            + "here. Revoke it through the identity review record instead.");
        }
        applyHandGrantedBadge(user, false);
        audit.record(actor, "user.badge", "user", id,
                "granted", "false", "reason", reason, "role", user.getRole());
        return view.row(user);
    }

    @Transactional(readOnly = true)
    Page<BadgeGrantResponse> list(String status, Pageable pageable) {
        String state = status == null || status.isBlank() ? BadgeGrantStatuses.PENDING : status.trim();
        if (!BadgeGrantStatuses.ALL.contains(state)) {
            throw new ValidationException("Unknown badge grant status '" + status
                    + "'. Expected one of pending, approved, rejected.");
        }
        Page<BadgeGrantRequest> page = requests.findByStatusOrderByCreatedAtAsc(state, pageable);
        Map<UUID, User> people = peopleFor(page.getContent());
        return page.map(request -> response(request, people));
    }

    @Transactional
    BadgeGrantResponse approve(AuthPrincipal actor, String id, String note) {
        BadgeGrantRequest request = locked(id);
        requirePending(request);
        requireDifferentChecker(actor, request);
        User user = users.findById(request.getUserId())
                .orElseThrow(() -> NotFoundException.of("User"));
        if (user.isVerified()) {
            throw new ConflictException("This user is already verified");
        }
        request.approve(actor.userId(), blankToNull(note));
        requests.saveAndFlush(request);
        applyHandGrantedBadge(user, true);
        audit.record(actor, "user.badge", "user", user.getId().toString(),
                "granted", "true", "reason", request.getReason(), "role", user.getRole(),
                "requestId", request.getId().toString());
        audit.record(actor, "user.badge.grant_approved", "badge_grant_request",
                request.getId().toString(), "userId", user.getId().toString(),
                "requestedBy", request.getRequestedBy().toString(), "note", note);
        return response(request);
    }

    @Transactional
    BadgeGrantResponse reject(AuthPrincipal actor, String id, String reason) {
        BadgeGrantRequest request = locked(id);
        String trimmedReason = validReason(reason, "reason");
        requirePending(request);
        requireDifferentChecker(actor, request);
        request.reject(actor.userId(), trimmedReason);
        audit.record(actor, "user.badge.grant_rejected", "badge_grant_request",
                request.getId().toString(), "userId", request.getUserId().toString(),
                "requestedBy", request.getRequestedBy().toString(), "reason", trimmedReason);
        return response(request);
    }

    private BadgeGrantRequest savePending(User user, UUID requestedBy, String reason) {
        try {
            return requests.saveAndFlush(new BadgeGrantRequest(user.getId(), requestedBy, reason));
        } catch (DataIntegrityViolationException conflict) {
            throw new ConflictException(
                    "This user already has a pending badge grant request. Approve or reject it first.");
        }
    }

    private static String validReason(String value, String field) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.length() < 10 || trimmed.length() > 300) {
            throw new BadRequestException(field + " must be 10 to 300 characters after trimming");
        }
        return trimmed;
    }

    private void refusePending(UUID userId, String message) {
        if (requests.existsByUserIdAndStatus(userId, BadgeGrantStatuses.PENDING)) {
            throw new ConflictException(message);
        }
    }

    private BadgeGrantRequest locked(String id) {
        UUID requestId = Ids.parseUuid(id).orElseThrow(() -> NotFoundException.of("Badge grant request"));
        return requests.findByIdForUpdate(requestId)
                .orElseThrow(() -> NotFoundException.of("Badge grant request"));
    }

    private static void requirePending(BadgeGrantRequest request) {
        if (!request.isPending()) {
            throw new ConflictException("This badge grant request is already " + request.getStatus());
        }
    }

    private static void requireDifferentChecker(AuthPrincipal actor, BadgeGrantRequest request) {
        if (actor.userId().equals(request.getRequestedBy())) {
            throw new ForbiddenException(
                    "A badge grant must be approved or rejected by an administrator other than the requester.");
        }
        if (actor.userId().equals(request.getUserId())) {
            throw new ForbiddenException("You cannot decide a badge grant request for your own account");
        }
    }

    private void applyHandGrantedBadge(User user, boolean granted) {
        if (user.isVerified() == granted) {
            return;
        }
        user.setVerified(granted);
        if (granted) {
            ownerBadges.markOwnerVerified(user.getId());
        } else {
            ownerBadges.markOwnerUnverified(user.getId());
        }
    }

    private BadgeGrantResponse response(BadgeGrantRequest request) {
        return response(request, peopleFor(java.util.List.of(request)));
    }

    private Map<UUID, User> peopleFor(java.util.List<BadgeGrantRequest> grantRequests) {
        Set<UUID> ids = new HashSet<>();
        grantRequests.forEach(request -> {
            ids.add(request.getUserId());
            ids.add(request.getRequestedBy());
            if (request.getDecidedBy() != null) {
                ids.add(request.getDecidedBy());
            }
        });
        return users.findAllById(ids).stream().collect(Collectors.toMap(User::getId, u -> u));
    }

    private static BadgeGrantResponse response(BadgeGrantRequest request, Map<UUID, User> people) {
        User user = people.get(request.getUserId());
        User maker = people.get(request.getRequestedBy());
        User checker = request.getDecidedBy() == null ? null : people.get(request.getDecidedBy());
        return new BadgeGrantResponse(
                request.getId().toString(),
                request.getUserId().toString(),
                user == null ? null : user.getName(),
                MobileMask.mask(user == null ? null : user.getMobile()),
                request.getRequestedBy().toString(),
                maker == null ? null : maker.getName(),
                request.getReason(),
                request.getStatus(),
                request.getDecidedBy() == null ? null : request.getDecidedBy().toString(),
                checker == null ? null : checker.getName(),
                request.getDecidedAt(),
                request.getDecisionNote(),
                request.getCreatedAt());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
