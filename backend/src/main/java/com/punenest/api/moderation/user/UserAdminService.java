package com.punenest.api.moderation.user;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserMapper;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.identity.user.UserResponse;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.util.Set;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * User administration — the back-office surface over other people's accounts.
 *
 * <p><strong>The list masks mobile numbers; the single-user read reveals them and writes an audit
 * row.</strong> That asymmetry is the design, not an inconsistency. Ops genuinely need a phone
 * number to act on a case, so refusing it would just push the work off-platform; but a paged list
 * hands over thousands of numbers per request for the cost of one click, which is a bulk-export
 * surface wearing the clothes of a search screen. Requiring one deliberate, individually-logged read
 * per person makes the cost of exfiltration linear in the number of people exfiltrated, and leaves a
 * trail that says exactly whose data was looked at.
 */
@Service
public class UserAdminService {

    /** Roles an admin may mint via {@code POST /users/staff}. */
    private static final Set<String> STAFF_ROLES = Set.of(Roles.Wire.STAFF, Roles.Wire.ADMIN);

    private final UserRepository users;
    private final UserMapper mapper;
    private final PasswordEncoder passwordEncoder;
    private final AuditService audit;

    public UserAdminService(UserRepository users, UserMapper mapper, PasswordEncoder passwordEncoder,
            AuditService audit) {
        this.users = users;
        this.mapper = mapper;
        this.passwordEncoder = passwordEncoder;
        this.audit = audit;
    }

    /**
     * {@code GET /users} — paged, mobile masked.
     *
     * <p>No audit row: this is a search, it reveals nothing that is not already masked, and logging
     * every list page would bury the reads that actually matter under noise. Auditing everything and
     * auditing nothing are equally useless.
     */
    @Transactional(readOnly = true)
    public Page<UserResponse> list(String role, String q, boolean archived, Pageable pageable) {
        String prefix = (q == null || q.isBlank()) ? null : likePrefix(q.trim().toLowerCase());
        return users.searchForAdmin(role, prefix, archived, pageable).map(this::masked);
    }

    /**
     * Turn a search term into an anchored LIKE pattern, neutralising the caller's own wildcards.
     *
     * <p>Without this, {@code ?q=%} is a request for every user on the platform, evaluated as an
     * unanchored scan that the {@code text_pattern_ops} index cannot serve. The escape character is
     * declared in the query itself — the two have to agree, so they are documented at both ends.
     */
    private static String likePrefix(String term) {
        return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }

    /**
     * {@code GET /users/{id}} — full detail including the unmasked mobile, audited.
     *
     * <p>The audit write is the price of the reveal. It is deliberately recorded before the response
     * is built so that a read cannot succeed unlogged.
     */
    @Transactional
    public UserResponse get(AuthPrincipal actor, String id) {
        User user = load(id);
        audit.record(actor, "user.contact.reveal", "user", id, "mobile", MobileMask.mask(user.getMobile()));
        return mapper.toResponse(user);
    }

    /** {@code PATCH /users/{id}} — admin-only profile correction (name/email/avatar). */
    @Transactional
    public UserResponse update(AuthPrincipal actor, String id, String name, String email, String avatar) {
        User user = load(id);
        if (name != null && !name.isBlank()) {
            user.setName(name.trim());
        }
        if (email != null && !email.isBlank()) {
            user.setEmail(email.trim());
        }
        if (avatar != null && !avatar.isBlank()) {
            user.setAvatar(avatar.trim());
        }
        audit.record(actor, "user.update", "user", id, "name", name, "email", email, "avatar", avatar);
        return mapper.toResponse(user);
    }

    /**
     * {@code PATCH /users/{id}/archive} — suspend a person from the platform.
     *
     * <p>An admin may not archive themselves. Not because it is dangerous in the abstract, but
     * because it is the one moderation action that destroys the ability to undo itself: the only
     * routes that can restore a user are admin-only, so a single-admin platform that archived its
     * admin would be permanently locked out of its own back office with no in-product recovery.
     */
    @Transactional
    public void archive(AuthPrincipal actor, String id, String reason) {
        User user = load(id);
        if (actor.userId().equals(user.getId())) {
            throw new ForbiddenException("You cannot archive your own account");
        }
        user.archive(reason);
        audit.record(actor, "user.archive", "user", id, "reason", reason, "role", user.getRole());
    }

    /** {@code PATCH /users/{id}/restore} — reinstate a suspended person. */
    @Transactional
    public void restore(AuthPrincipal actor, String id) {
        User user = load(id);
        user.restore();
        audit.record(actor, "user.restore", "user", id, "role", user.getRole());
    }

    /**
     * {@code POST /users/staff} — privilege escalation, admin only.
     *
     * <p>The contract's {@code StaffCreate} carries a free {@code role} field, so the role is
     * validated here against {@code staff|admin} rather than trusted: without that check the
     * endpoint would be a general-purpose account factory, and — worse — nothing would stop an admin
     * typo from creating an account with a role the platform has no notion of.
     *
     * <p>A staff account is created without a mobile-verified flag; the colleague still signs in via
     * the normal password path. The password is BCrypt-hashed by the shared encoder, never stored or
     * logged in the clear — note the audit row records the new user's role and email, never the
     * password, and never the mobile.
     *
     * <p>{@code mobile} is required, and had to be <em>added to the contract</em> (spec fix S33):
     * {@code users.mobile} is {@code NOT NULL UNIQUE}, so without it this endpoint could not insert
     * a row at all. Relaxing the column was the alternative and the wrong one — it would weaken the
     * platform's natural key for every user to accommodate a handful of colleagues.
     */
    @Transactional
    public UserResponse addStaff(AuthPrincipal actor, String name, String mobile, String email,
            String role, String team, String password) {
        if (!STAFF_ROLES.contains(role)) {
            throw new ForbiddenException("Staff accounts may only be created with role staff or admin");
        }
        if (users.existsByMobile(mobile)) {
            throw new ConflictException("A user with that mobile already exists");
        }
        if (users.existsByEmailAndArchivedFalse(email)) {
            throw new ConflictException("A user with that email already exists");
        }
        User user = new User(mobile, role);
        user.setName(name.trim());
        user.setEmail(email.trim());
        user.setTeam(team);
        if (password != null && !password.isBlank()) {
            user.setPasswordHash(passwordEncoder.encode(password));
        }
        User saved = users.save(user);
        audit.record(actor, "user.staff.create", "user", saved.getId().toString(),
                "email", email, "role", role, "team", team);
        return mapper.toResponse(saved);
    }

    /** Mask the mobile on the wire without touching the managed entity. */
    private UserResponse masked(User user) {
        UserResponse full = mapper.toResponse(user);
        return new UserResponse(full.id(), full.name(), MobileMask.mask(full.mobile()), full.email(),
                full.role(), full.team(), full.status(), full.verified(), full.city(),
                full.mobileVerified(), full.aadhaarVerified(), full.verifiedContactOnly(),
                full.hideNumber(), full.listingsCount(), full.joinedAt(), full.lastActive(),
                full.createdAt());
    }

    private User load(String id) {
        return Ids.parseUuid(id)
                .flatMap(users::findById)
                .orElseThrow(() -> NotFoundException.of("User"));
    }
}
