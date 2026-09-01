package com.draazy.api.security;

import java.util.Optional;
import java.util.UUID;

/**
 * The role an account holds <em>now</em>, read on the authorisation path — the parse-side
 * counterpart to {@link TokenSubject} (tech debt D201).
 *
 * <p><strong>Why the role is not simply read off the token.</strong> A role embedded in a signed JWT
 * is a snapshot of a policy that has since been allowed to change. {@code AccountPermissions} and
 * {@link PermissionMap} already refuse to work that way — both re-read their document on every
 * request, precisely so that revoking somebody's access lands on their next call rather than
 * whenever their token happens to expire. The role was the one input to the same decision that did
 * not: an administrator demoted to staff kept admin-level route access for the rest of the token's
 * life, while a permission taken away from that same account in the same console screen took effect
 * immediately. Two controls presented side by side behaved differently, and only one of them said
 * so.
 *
 * <p><strong>Why this is an interface in the kernel rather than a repository call.</strong>
 * {@code users} belongs to a feature context, and {@code docs/system/package-structure.md} §2
 * forbids the shared kernel from importing one — a reference from here into {@code identity} routes
 * a cycle through the kernel and welds the two together permanently. The dependency is not real,
 * only accidental: the filter wants one string. So the abstraction lives here and the feature
 * satisfies it, exactly as {@code User implements TokenSubject} does for the issuing side. Tokens
 * are made of claims at both ends; this is the one claim the server keeps checking.
 */
public interface RoleSource {

    /**
     * The stored {@link Roles.Wire} role for {@code userId}, or empty when no row names them.
     *
     * <p>Empty is <strong>not</strong> a denial, and callers must not turn it into one. It means the
     * database has nothing to say about this account, which is a different fact from "this account
     * has been demoted" — and the caller that has to choose between them is holding a
     * signature-verified token, so the honest reading is the same one {@link PermissionMap} gives a
     * missing document: no stored policy, so the compiled-in one applies. Whether a token should
     * outlive the row it names is session revocation's question, not this one.
     */
    Optional<String> roleOf(UUID userId);
}
