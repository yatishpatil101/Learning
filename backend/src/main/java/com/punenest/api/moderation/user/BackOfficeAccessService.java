package com.punenest.api.moderation.user;

import com.punenest.api.common.access.BackOfficeGrant;
import com.punenest.api.common.access.BackOfficeGrantRepository;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.error.ValidationException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AccountPermissions;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.Roles;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Read and replace one back-office account's permission document (tech debt D192/D13).
 *
 * <p>This is the half {@code V61} said did not exist: "no team-member management endpoint of any
 * kind — the Team &amp; Access console writes to browser storage". A document nothing can write is
 * as useless as one nothing reads, and a document the <em>browser</em> writes is the allow-list the
 * client opts out of, so both halves ship together or neither does.
 *
 * <h2>The four refusals, and why each is a refusal rather than a shrug</h2>
 *
 * <ol>
 *   <li><strong>A name the catalogue does not contain.</strong> 422. {@link AccountPermissions}
 *       would drop it harmlessly, so storing it would be safe — and that is exactly the problem it
 *       would cause. {@code settings.customRoles} was safe for its whole life too, right up until
 *       somebody wired it and it began granting what had accumulated in it while an operator was
 *       told it did something. An administrator who ticks {@code properties:verify} because their
 *       console still offers it must be told the server does not enforce it, not quietly obeyed.</li>
 *   <li><strong>A name this account's role can never hold.</strong> 422. The intersection would drop
 *       it, so this is the same argument one rung down: a stored {@code settings:write} on a staff
 *       account is a line in an access-control document that reads like a grant and is not one.</li>
 *   <li><strong>A target who is not staff or admin.</strong> 422. A buyer has no back-office
 *       baseline to narrow, so a document for one could only ever be read as an attempt to grant.
 *       Refusing here means the table never holds a row whose only possible reading is the wrong
 *       one.</li>
 *   <li><strong>The caller editing their own document.</strong> 403, and this one is operational
 *       rather than philosophical. Writing this document requires {@code users:write}; an
 *       administrator who removes {@code users:write} from themselves has removed the ability to put
 *       it back, and the repair is a database edit during whatever incident prompted the change.
 *       Two administrators can still scope each other, which is the maker-checker shape this
 *       surface should have had anyway.</li>
 * </ol>
 *
 * <p><strong>Every write is audited</strong>, with the resulting document in the context. The audit
 * row is the only record of what an account's access used to be — the table itself keeps just the
 * current document, deliberately, since a history table for a control this small would be more
 * machinery than the question deserves and {@code audit_log} already answers "who changed what".
 */
@Service
public class BackOfficeAccessService {

    private final UserRepository users;
    private final BackOfficeGrantRepository grants;
    private final AccountPermissions accountPermissions;
    private final ObjectMapper objectMapper;
    private final AuditService audit;
    private final AdministratorGuard administrators;

    public BackOfficeAccessService(UserRepository users, BackOfficeGrantRepository grants,
            AccountPermissions accountPermissions, ObjectMapper objectMapper, AuditService audit,
            AdministratorGuard administrators) {
        this.users = users;
        this.grants = grants;
        this.accountPermissions = accountPermissions;
        this.objectMapper = objectMapper;
        this.audit = audit;
        this.administrators = administrators;
    }

    /** Everything the server enforces, in render order. Static data; no account is involved. */
    public List<BackOfficePermissions.Permission> catalogue() {
        return BackOfficePermissions.CATALOGUE;
    }

    /** {@code GET /users/{id}/permissions}. */
    @Transactional(readOnly = true)
    public BackOfficeAccessResponse read(String id) {
        User target = load(id);
        Optional<BackOfficeGrant> stored = grants.findById(target.getId());
        return new BackOfficeAccessResponse(
                target.getId().toString(),
                target.getRole(),
                stored.isPresent(),
                stored.map(grant -> parseStored(grant.getPermissions())).orElse(List.of()),
                List.copyOf(accountPermissions.effectiveFor(target.getRole(), target.getId())));
    }

    /**
     * {@code PUT /users/{id}/permissions} — replace the document wholesale.
     *
     * <p>Wholesale rather than incremental because the caller is describing the access this account
     * should have. A merge could not express "take this away", which is the operation the feature
     * exists for.
     *
     * @param requested the atoms to store; an empty list is legal and means "no guarded back-office
     *                  route", which is a different statement from having no document at all
     */
    @Transactional
    public BackOfficeAccessResponse replace(AuthPrincipal actor, String id,
            List<String> requested) {
        User target = load(id);
        if (actor.userId().equals(target.getId())) {
            throw new ForbiddenException(
                    "An administrator cannot edit their own back-office permissions");
        }
        if (!Roles.Wire.STAFF.equals(target.getRole()) && !Roles.Wire.ADMIN.equals(target.getRole())) {
            throw new ValidationException(
                    "Only staff and admin accounts have back-office permissions to narrow");
        }
        Set<String> ceiling = BackOfficePermissions.baselineFor(target.getRole());
        Set<String> names = new LinkedHashSet<>();
        for (String name : requested == null ? List.<String>of() : requested) {
            if (!BackOfficePermissions.isKnown(name)) {
                throw new ValidationException(
                        "Not a permission this server enforces: " + name);
            }
            if (!ceiling.contains(name)) {
                throw new ValidationException(
                        "A " + target.getRole() + " account can never hold " + name);
            }
            names.add(name);
        }

        // The last-administrator floor (D200). Checked after validation and before the write, so a
        // refusal leaves the stored document exactly as it was and the caller can resend. Narrowing
        // is the quiet half of a back-office lockout: unlike an archive it leaves an account that
        // still reads `admin` on every screen and can no longer hand access back to anybody.
        administrators.refuseIfNarrowingRemovesLastAdministrator(target, names);

        String document = objectMapper.writeValueAsString(names);
        BackOfficeGrant grant = grants.findById(target.getId()).orElse(null);
        if (grant == null) {
            grant = new BackOfficeGrant(target.getId(), document, actor.userId());
        } else {
            grant.replace(document, actor.userId());
        }
        grants.save(grant);
        audit.record(actor, "user.permissions.replace", "user", target.getId().toString(),
                "permissions", document);
        return read(id);
    }

    /**
     * The stored names as a list, or an empty list if the row is unreadable.
     *
     * <p>The screen showing an administrator a corrupt document as "nothing stored" is a lie the
     * effective set immediately corrects: {@link AccountPermissions} denies everything for that row,
     * so the response's {@code effective} is empty too — and empty-effective with a
     * {@code scoped: true} flag is a state the console can only reach this way. Throwing instead
     * would take the repair screen down along with the row it exists to repair.
     */
    private List<String> parseStored(String raw) {
        try {
            JsonNode document = objectMapper.readTree(raw);
            if (!document.isArray()) {
                return List.of();
            }
            List<String> names = new ArrayList<>();
            for (JsonNode entry : document) {
                if (entry.isString()) {
                    names.add(entry.stringValue());
                }
            }
            return List.copyOf(names);
        } catch (RuntimeException unreadable) {
            return List.of();
        }
    }

    private User load(String id) {
        return Ids.parseUuid(id)
                .flatMap(users::findById)
                .orElseThrow(() -> NotFoundException.of("User"));
    }
}
