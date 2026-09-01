package com.punenest.api.identity.user;

import com.punenest.api.security.AccountPermissions;
import com.punenest.api.security.Roles;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * The caller's own profile — {@link UserMapper}'s output plus the one field that only makes sense
 * when the subject and the reader are the same person: their resolved back-office permission atoms.
 *
 * <p>This exists as its own collaborator because <em>four</em> routes return the caller to
 * themselves — {@code POST /auth/login}, {@code POST /auth/staff-login} (both via
 * {@code AuthService}), {@code GET /auth/me} and {@code PATCH /auth/me} — and every one of them
 * feeds the same client-side cache. Populating the atoms on only one of them is worse than
 * populating none: the console would draw a correct sidebar on a page reload and an empty one
 * immediately after sign-in, and a profile edit would silently strip the atoms back out again,
 * because {@code authProvider.updateMe} writes whatever the PATCH returned over the cached user. A
 * field that is right on some of a resource's representations and absent on the rest is a race, not
 * a contract.
 *
 * <p>Deliberately <em>not</em> folded into {@link UserMapper}. The mapper's job is
 * entity→wire, and these atoms are on no entity: they are a resolution of the account's stored
 * permission document against its role baseline, computed per read. Every other caller of the mapper
 * — the admin user directory, moderation, staff approval — is describing somebody else, and must
 * keep emitting nothing at all for this field.
 */
@Component
public class SelfProfile {

    private final UserMapper userMapper;
    private final AccountPermissions accountPermissions;

    public SelfProfile(UserMapper userMapper, AccountPermissions accountPermissions) {
        this.userMapper = userMapper;
        this.accountPermissions = accountPermissions;
    }

    /**
     * Project a user as their own profile.
     *
     * <p>Consumers and owners come back untouched, so {@code permissions} stays null and
     * {@code NON_NULL} drops the key entirely: they have no back-office baseline, and answering
     * "none" would imply the question had been asked of them. A staff or admin account always gets a
     * list, possibly empty — "scoped to nothing" is a real state, and a console has to be able to
     * tell it apart from "this route did not say".
     *
     * <p>{@link AccountPermissions#effectiveFor} intersects the stored document with the role
     * ceiling, so what ships is what the server will actually honour. A console navigating from the
     * raw document would show a tab for every atom an administrator had granted above the ceiling,
     * which is precisely the drift V61 deleted.
     */
    public UserResponse of(User user) {
        UserResponse base = userMapper.toResponse(user);
        if (!backOffice(user.getRole())) {
            return base;
        }
        List<String> atoms =
                List.copyOf(accountPermissions.effectiveFor(user.getRole(), user.getId()));
        return new UserResponse(base.id(), base.name(), base.mobile(), base.email(), base.role(),
                base.team(), base.status(), base.verified(), base.city(), base.mobileVerified(),
                base.aadhaarVerified(), base.verifiedContactOnly(), base.hideNumber(),
                base.listingsCount(), base.joinedAt(), base.lastActive(), base.createdAt(), atoms,
                // Nulls on purpose, and NON_NULL drops both keys: the review flag is a note between
                // moderators about this person, and this is the one route that serves it *to* them.
                null, null);
    }

    private static boolean backOffice(String wireRole) {
        return Roles.Wire.STAFF.equals(wireRole) || Roles.Wire.ADMIN.equals(wireRole);
    }
}
