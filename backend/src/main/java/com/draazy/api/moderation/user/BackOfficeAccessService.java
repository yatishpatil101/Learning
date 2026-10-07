package com.draazy.api.moderation.user;

import com.draazy.api.common.access.BackOfficeGrant;
import com.draazy.api.common.access.BackOfficeGrantRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficeFunctions;
import com.draazy.api.security.Roles;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Replaces one account's permission document; each write is audited since the table keeps only the current one.
 * Self-edit is refused: dropping {@code users:write} would lock the caller out. */
@Service
public class BackOfficeAccessService {

    private final UserRepository users;
    private final BackOfficeGrantRepository grants;
    private final AccountPermissions accountPermissions;
    private final ObjectMapper objectMapper;
    private final AuditService audit;
    private final AdminActionNotifier adminNotifications;

    public BackOfficeAccessService(UserRepository users, BackOfficeGrantRepository grants,
            AccountPermissions accountPermissions, ObjectMapper objectMapper, AuditService audit,
            AdminActionNotifier adminNotifications) {
        this.users = users;
        this.grants = grants;
        this.accountPermissions = accountPermissions;
        this.objectMapper = objectMapper;
        this.audit = audit;
        this.adminNotifications = adminNotifications;
    }


    public List<BackOfficeFunctions.Function> functionCatalogue() {
        return BackOfficeFunctions.CATALOGUE;
    }

    /** {@code GET /users/{id}/permissions}. */
    @Transactional(readOnly = true)
    public BackOfficeAccessResponse read(AuthPrincipal actor, String id) {
        User target = load(id);
        if (!actor.userId().equals(target.getId())) {
            refuseManagerOnNonStaff(actor, target);
        }
        Optional<BackOfficeGrant> stored = grants.findById(target.getId());
        List<String> storedFunctions = stored.map(grant -> parseStored(grant.getPermissions())).orElse(List.of());
        List<String> functions = functionsOf(target, stored.orElse(null));
        return new BackOfficeAccessResponse(
                target.getId().toString(),
                target.getRole(),
                stored.isPresent(),
                functions,
                storedFunctions,
                List.copyOf(accountPermissions.effectiveFor(target.getRole(), target.getId())),
                List.copyOf(accountPermissions.desksFor(target.getRole(), target.getId())));
    }

    /** Functions are filled on the same terms as {@link #read}: an administrator reads any non-administrator, a manager only staff and itself. */
    @Transactional(readOnly = true)
    public List<TeamMemberResponse> roster(AuthPrincipal actor) {
        List<User> accounts = users.findBackOfficeAccounts();
        Map<UUID, BackOfficeGrant> stored = grants.findAllById(accounts.stream()
                        .filter(account -> !Roles.Wire.ADMIN.equals(account.getRole()))
                        .map(User::getId).toList())
                .stream().collect(Collectors.toMap(BackOfficeGrant::getUserId, Function.identity()));
        return accounts.stream().map(account -> new TeamMemberResponse(
                account.getId().toString(), account.getName(), account.getMobile(),
                account.getEmail(), account.getRole(), account.getStatus(), account.isArchived(),
                account.getCreatedAt(),
                readable(actor, account) ? functionsOf(account, stored.get(account.getId())) : List.of()))
                .toList();
    }

    private static boolean readable(AuthPrincipal actor, User target) {
        if (Roles.Wire.ADMIN.equals(target.getRole())) {
            return false;
        }
        return !Roles.Wire.MANAGER.equals(actor.role())
                || actor.userId().equals(target.getId())
                || Roles.Wire.STAFF.equals(target.getRole());
    }

    private List<String> functionsOf(User target, BackOfficeGrant stored) {
        return stored != null
                ? parseStored(stored.getPermissions())
                : List.copyOf(BackOfficeFunctions.defaultForRole(target.getRole()));
    }

    /** Wholesale because a merge could not express "take this away"; an empty list is legal and means "dashboard only", unlike no document at all. */
    @Transactional
    public BackOfficeAccessResponse replace(AuthPrincipal actor, String id,
            List<String> requested) {
        User target = load(id);
        if (actor.userId().equals(target.getId())) {
            throw new ForbiddenException(
                    "You cannot edit your own back-office permissions");
        }
        if (!Roles.isBackOffice(target.getRole())) {
            throw new ValidationException(
                    "Only back-office accounts have permissions to narrow");
        }
        refuseManagerOnNonStaff(actor, target);
        if (Roles.Wire.ADMIN.equals(target.getRole())) {
            throw new ValidationException("The administrator always holds full access");
        }
        Set<String> ceiling = BackOfficeFunctions.assignableForRole(target.getRole());
        Set<String> actorCeiling = Roles.Wire.MANAGER.equals(actor.role())
                ? accountPermissions.functionsFor(actor.role(), actor.userId())
                : null;
        // A manager may keep or remove what an administrator granted; only additions are capped.
        Set<String> held = accountPermissions.functionsFor(target.getRole(), target.getId());
        Set<String> names = new LinkedHashSet<>();
        for (String name : requested == null ? List.<String>of() : requested) {
            if (!BackOfficeFunctions.isKnown(name)) {
                throw new ValidationException(
                        "Not a back-office function this server enforces: " + name);
            }
            if (!ceiling.contains(name)) {
                throw new ValidationException(
                        "A " + target.getRole() + " account can never hold " + name);
            }
            if (actorCeiling != null && !actorCeiling.contains(name) && !held.contains(name)) {
                throw new ForbiddenException("Managers can only grant functions they hold");
            }
            names.add(name);
        }

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
        adminNotifications.managerAction(actor, "Updated staff permissions", target);
        return read(actor, id);
    }

    /** Unreadable rows give an empty list so the repair screen survives the row it repairs. */
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

    private static void refuseManagerOnNonStaff(AuthPrincipal actor, User target) {
        if (Roles.Wire.MANAGER.equals(actor.role()) && !Roles.Wire.STAFF.equals(target.getRole())) {
            throw new ForbiddenException("Managers can only manage staff accounts");
        }
    }
}
