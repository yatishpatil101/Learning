package com.punenest.api.moderation.user;

import com.punenest.api.common.access.StaffAccountApproval;
import com.punenest.api.common.access.StaffAccountApprovalRepository;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.auth.StaffInviteService;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserMapper;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.identity.user.UserResponse;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
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
    private final AuditService audit;
    private final AdministratorGuard administrators;
    private final StaffAccountApprovalRepository approvals;
    private final StaffInviteService invites;

    public UserAdminService(UserRepository users, UserMapper mapper,
            AuditService audit, AdministratorGuard administrators,
            StaffAccountApprovalRepository approvals, StaffInviteService invites) {
        this.users = users;
        this.mapper = mapper;
        this.audit = audit;
        this.administrators = administrators;
        this.approvals = approvals;
        this.invites = invites;
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

    /**
     * {@code PATCH /users/{id}} — admin-only profile correction (name/email/avatar).
     *
     * <p>An email correction is refused when a different live account already holds the address.
     * Compared without regard to case, matching V70's {@code lower(email)} index: without the guard
     * the flush hit that index and the operator got the constraint handler's generic conflict,
     * which names neither the field nor the account it collided with.
     */
    @Transactional
    public UserResponse update(AuthPrincipal actor, String id, String name, String email, String avatar) {
        User user = load(id);
        if (name != null && !name.isBlank()) {
            user.setName(name.trim());
        }
        if (email != null && !email.isBlank()) {
            String address = email.trim();
            if (users.existsOtherLiveWithEmailIgnoreCase(address, user.getId())) {
                throw new ConflictException("A user with that email already exists");
            }
            user.setEmail(address);
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
     *
     * <p><strong>Nor may they archive the last administrator who is not themselves</strong> (tech
     * debt D200). The self-check above was the whole guard, which meant the lockout it describes was
     * reachable in one more step: two administrators, each archiving the other's ability to undo it,
     * or one narrowed account removing the person who narrowed it. {@link AdministratorGuard} asks
     * the question the self-check was standing in for — <em>would anybody still be able to hand
     * access back</em> — and answers 409 rather than 403, because the caller is entitled to this
     * route and it is the platform's state that forbids the request.
     */
    @Transactional
    public void archive(AuthPrincipal actor, String id, String reason) {
        User user = load(id);
        if (actor.userId().equals(user.getId())) {
            throw new ForbiddenException("You cannot archive your own account");
        }
        administrators.refuseIfLastAdministrator(user);
        user.archive(reason);
        audit.record(actor, "user.archive", "user", id, "reason", reason, "role", user.getRole());
    }

    /**
     * {@code PATCH /users/{id}/restore} — reinstate a suspended person.
     *
     * <p><strong>Refused when bringing this account back would put two live accounts on one email
     * address.</strong> Archiving is a soft delete, so {@link #addStaff}'s duplicate check — which
     * asks only about <em>live</em> rows — legitimately passes once an address has been archived.
     * That is the whole sequence: create {@code a@x.com}, archive it, create {@code a@x.com} again,
     * then restore the first. Nothing in that story is a mistake until the last step, and the last
     * step used to validate nothing at all.
     *
     * <p>What made it more than untidy is where the damage surfaced. {@code identity.auth
     * .AuthService#staffLogin} resolves the account with {@code findByEmailIgnoreCaseAndArchivedFalse}, an
     * {@code Optional}-returning lookup: two matching rows is not a login failure, it is an
     * {@code IncorrectResultSizeDataAccessException} — a 500 on every subsequent sign-in attempt for
     * that address, for both people, with no route back through the back office, because the restore
     * that caused it reported success and the screen shows two ordinary accounts.
     *
     * <p>409 rather than 403: the caller is entitled to this route, and it is the platform's current
     * state that forbids the request — the same reading {@link #archive} takes for the
     * last-administrator floor. The message names the address and the way out, because the operator
     * can act on this: archive or re-address the account now holding it, then restore again.
     *
     * <p>The guard reads the database, not the entity, and runs <em>before</em> {@code restore()},
     * so the row is still archived and cannot match itself. V70's partial unique index enforces the
     * same invariant underneath; this exists so that the reachable, operator-driven path answers
     * with something actionable rather than the constraint handler's generic conflict text.
     */
    @Transactional
    public void restore(AuthPrincipal actor, String id) {
        User user = load(id);
        refuseIfEmailIsHeldByALiveAccount(user);
        user.restore();
        audit.record(actor, "user.restore", "user", id, "role", user.getRole());
    }

    /**
     * Refuse a restore that would leave two live accounts sharing an email address.
     *
     * <p>Compared without regard to case, matching the index that backs it. An account with no email
     * has nothing to collide on and is always restorable.
     */
    private void refuseIfEmailIsHeldByALiveAccount(User user) {
        String email = user.getEmail();
        if (email == null || email.isBlank()) {
            return;
        }
        if (users.existsOtherLiveWithEmailIgnoreCase(email, user.getId())) {
            throw new ConflictException(
                    "Another active account already uses " + email + ". Archive or change the email "
                            + "on that account first, then restore this one.");
        }
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
     * the normal password path. <strong>Nobody here supplies that password</strong> — see the
     * activation section below.
     *
     * <p>{@code mobile} is required, and had to be <em>added to the contract</em> (spec fix S33):
     * {@code users.mobile} is {@code NOT NULL UNIQUE}, so without it this endpoint could not insert
     * a row at all. Relaxing the column was the alternative and the wrong one — it would weaken the
     * platform's natural key for every user to accommodate a handful of colleagues. It is now
     * load-bearing for a second reason: it is where the invite is delivered.
     *
     * <h2>Activation (tech debt D206)</h2>
     *
     * <p>The account is created <strong>with no usable password</strong>, and a single-use,
     * time-limited invite is issued to the colleague's own mobile. They set their own credential
     * through {@code POST /auth/staff-invite/redeem}; until they do, {@code identity.auth
     * .AuthService} refuses to issue a token for the account on every login path.
     *
     * <p>This is what makes the second signature worth having. {@code StaffCreate} used to carry a
     * {@code password}, so the maker chose the credential the account would sign in with — the
     * checker was co-signing a <em>record</em> ("an ops lead should exist") while the maker walked
     * away holding the <em>person's</em> session. Nothing downstream could tell the difference:
     * everything the checker was shown was a name, an email and a role, all of which were true.
     *
     * <p><strong>Neither administrator ever learns the token.</strong> It is handed straight to the
     * delivery seam inside {@link StaffInviteService#issue} and is not returned from there, so it
     * cannot reach this method, the 201 body, or the audit row. Returning it "just for the maker to
     * pass on" would restore the exact defect: the maker would hold the credential again.
     *
     * <p>The invite is issued <em>whether or not</em> the account is held for approval, including on
     * the bootstrap escape below. That case is the one that would otherwise still be broken: with no
     * approval row there is nothing else stopping the account, and an account with no password is
     * not thereby unreachable — it has a mobile number, and OTP login needs no password.
     *
     * <h2>Maker-checker (tech debt D200)</h2>
     *
     * <p>The account is created and <strong>cannot authenticate</strong> until a second
     * administrator approves it. This is the fix for the escalation D200 records: an administrator
     * narrowed to {@code users:write} could mint a fresh administrator, which has no permission
     * document and therefore resolves to the full role baseline, and recover every module it had
     * just been scoped out of. Every call in that sequence is individually authorised, so nothing
     * downstream could ever have flagged it; the only place to break the chain is here.
     *
     * <p><strong>Blocked at authentication rather than at permissions</strong>, deliberately. An
     * account that can obtain a token and holds nothing is still a foothold: it has a session, it
     * appears in the directory, and every future route that forgets its guard is reachable from it.
     * {@code identity.auth.AuthService} refuses to issue tokens for it on both login paths — the
     * password path <em>and</em> the mobile-OTP path, which is the one an attacker would actually
     * use, since the account they minted has a mobile number and OTP login needs no password.
     *
     * <p><strong>The bootstrap escape.</strong> When no other {@code admin}-role account exists at
     * all, no row is written and the account is live immediately. The reasoning is in
     * {@link AdministratorGuard#approvalIsPossible}; the short version is that maker-checker offers
     * exactly one guarantee — two people agreed — and on a platform with one administrator that
     * guarantee is unobtainable, so requiring them to co-sign with themselves buys nothing and costs
     * the first expansion of the team a permanent lockout. The escape is re-evaluated on every
     * creation, so it closes by itself the moment a second administrator exists, and it is
     * <em>audited under its own action name</em> rather than hidden inside the ordinary one, so
     * "this account skipped maker-checker" is a fact somebody can search for.
     *
     * <p>Note that the two halves of D200 hold each other up: the escape asks whether a second
     * administrator has <em>ever</em> existed, and the floor in {@link AdministratorGuard} stops an
     * attacker archiving their way down to being the only one. Either half alone would leave the
     * other reachable.
     */
    @Transactional
    public UserResponse addStaff(AuthPrincipal actor, String name, String mobile, String email,
            String role, String team) {
        // @IndianMobile validated the shape; canonicalise so the dedup check and the stored row key
        // off the same ten digits the column CHECK enforces.
        mobile = MobileMask.normalise(mobile);
        if (!STAFF_ROLES.contains(role)) {
            throw new ForbiddenException("Staff accounts may only be created with role staff or admin");
        }
        if (users.existsByMobile(mobile)) {
            throw new ConflictException("A user with that mobile already exists");
        }
        if (users.existsByEmailIgnoreCaseAndArchivedFalse(email)) {
            throw new ConflictException("A user with that email already exists");
        }
        User user = new User(mobile, role);
        user.setName(name.trim());
        user.setEmail(email.trim());
        user.setTeam(team);
        // No password is set, and there is no parameter that could set one (D206). The account is
        // activated by its own holder through the invite issued below.
        // Decided BEFORE the insert, and the order is the whole correctness of the bootstrap
        // escape: `approvalIsPossible` excludes only the creator, and the account being created is
        // about to count itself. See its Javadoc for what asking afterwards costs; pinned by
        // `theSoleAdministratorsFirstAdminColleagueIsNotHeld`.
        boolean needsApproval = administrators.approvalIsPossible(actor.userId());
        // saveAndFlush, not save: the approval row's FK names this id, and the insert below has to
        // land after the user row exists rather than in whatever order the flush happens to pick.
        User saved = users.saveAndFlush(user);
        if (needsApproval) {
            approvals.save(new StaffAccountApproval(saved.getId(), actor.userId()));
        }
        // Same transaction as the account, so there is no window in which a passwordless account
        // exists with nothing holding it shut. The raw token goes to `mobile` and is not returned.
        invites.issue(saved.getId(), mobile, actor.userId());
        audit.record(actor, needsApproval ? "user.staff.create" : "user.staff.create.bootstrap",
                "user", saved.getId().toString(),
                "email", email, "role", role, "team", team);
        return mapper.toResponse(saved);
    }

    /**
     * {@code GET /users/pending-approvals} — the accounts that cannot yet sign in (D200).
     *
     * <p>Unpaged, because the list is bounded by the number of colleagues nobody has got round to
     * approving; a platform where that needs a second page has a process problem, not a pagination
     * problem.
     *
     * <p>Mobiles are masked, exactly as {@link #list} masks them. The reveal on this platform is a
     * deliberate, individually-audited act ({@link #get}), and a queue screen that handed over an
     * unmasked number per waiting colleague would be a small bulk-export surface wearing the clothes
     * of a to-do list.
     */
    @Transactional(readOnly = true)
    public List<UserResponse> pendingApprovals() {
        return approvals.findByApprovedAtIsNullOrderByCreatedAtAsc().stream()
                .map(StaffAccountApproval::getUserId)
                .map(users::findById)
                .flatMap(Optional::stream)
                .map(this::masked)
                .toList();
    }

    /**
     * {@code POST /users/{id}/approve} — the second key (D200).
     *
     * <p><strong>The approver may not be the creator</strong>, which is the entire content of
     * maker-checker and the only reason this endpoint closes anything. It is refused here with a 403
     * that says why, and again by a CHECK constraint in V67 — twice on purpose, because a two-key
     * rule enforced in one place is a one-key rule with extra steps, and the second write path that
     * bypasses this service is always the one nobody remembered to look at.
     *
     * <p>Not idempotent. Approving an account that has already been approved is 409, not a silent
     * repeat: the second caller believes they are the checker on a decision that was in fact made by
     * somebody else, and letting that succeed would put a wrong name in their head about who
     * vouched. Approving an account that was never subject to maker-checker is 409 for the same
     * reason — nothing is wrong with the account, and pretending to approve it would manufacture a
     * record of a decision that never happened.
     *
     * <p>Also 403 when the <em>approver</em> is no longer a live account. Reaching this method proves
     * only that the caller held a valid access token, and an administrator archived five minutes ago
     * holds one until it expires; role and {@code users:write} are re-resolved per request by the
     * route guard, but liveness was nobody's job until it was checked here.
     *
     * <p>The audit row on the self-approval refusal survives the 403 because {@code AuditService} is
     * {@code REQUIRES_NEW} and commits in its own transaction — not because of any rule here.
     * Nothing else on either refusal path mutates anything, so there is no state to preserve and no
     * {@code noRollbackFor} to add. Said explicitly because the opposite is easy to assume: if you
     * add a write above the refusals, it will roll back with them, and the audit row will not.
     */
    @Transactional
    public UserResponse approve(AuthPrincipal actor, String id) {
        // Deliberately not AdministratorGuard.isCapable, which additionally excludes accounts
        // awaiting approval: that case cannot arise, because such an account cannot obtain a token.
        // Pinned by `anArchivedAdministratorCannotApprove`, which answers 200 without this.
        users.findByIdAndArchivedFalse(actor.userId())
                .orElseThrow(() -> new ForbiddenException(
                        "This account is no longer active and cannot approve colleagues."));
        User target = load(id);
        StaffAccountApproval approval = approvals.findById(target.getId())
                .orElseThrow(() -> new ConflictException(
                        "This account is not waiting for approval — it can already sign in."));
        if (approval.isApproved()) {
            throw new ConflictException("This account has already been approved.");
        }
        if (approval.getCreatedBy().equals(actor.userId())) {
            audit.record(actor, "user.staff.approve.refused", "user", target.getId().toString(),
                    "reason", "checker is maker", "role", target.getRole());
            throw new ForbiddenException(
                    "An account must be approved by an administrator other than the one who "
                            + "created it. Ask a colleague to approve this one.");
        }
        approval.approve(actor.userId());
        approvals.save(approval);
        audit.record(actor, "user.staff.approve", "user", target.getId().toString(),
                "createdBy", approval.getCreatedBy().toString(), "role", target.getRole());
        return masked(target);
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
