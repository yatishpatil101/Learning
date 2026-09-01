package com.draazy.api.security;

/**
 * The role vocabulary, in both forms the application needs.
 *
 * <p>A role exists as two different strings and that is a genuine trap: the JWT {@code role} claim,
 * the {@code users.role} column, and the JSON the React client reads are all <strong>lower-case</strong>
 * ({@code buyer}/{@code owner}/{@code staff}/{@code admin}, per the OpenAPI {@code Role} enum), while
 * Spring Security matches <strong>upper-case</strong> authorities ({@link JwtAuthFilter} grants
 * {@code ROLE_<UPPER>}, and {@code hasRole} re-adds the prefix). Both forms are therefore kept here,
 * side by side, so the relationship is visible and neither can be typo'd in isolation.
 *
 * <p>Both must be compile-time constants: the upper-case form is used inside
 * {@code @PreAuthorize("hasRole(...)")} annotations, so it cannot be derived at runtime with
 * {@code toUpperCase()}.
 */
public final class Roles {

    /** Authority names for {@code @PreAuthorize} guards. Spring prefixes these with {@code ROLE_}. */
    public static final String BUYER = "BUYER";
    public static final String OWNER = "OWNER";
    public static final String STAFF = "STAFF";
    public static final String ADMIN = "ADMIN";

    private Roles() {
    }

    /**
     * The wire form: the value carried in the JWT {@code role} claim, stored in {@code users.role},
     * and serialized to the client. These are contract values — renaming one breaks the frontend.
     */
    public static final class Wire {

        private Wire() {
        }

        /** Property seekers. Buyers and tenants share this single role, and it is the sign-up default. */
        public static final String BUYER = "buyer";

        /** A user who has posted at least one listing. */
        public static final String OWNER = "owner";

        /** Internal ops. Scoped further by {@code team}. */
        public static final String STAFF = "staff";

        /** Internal administrator. */
        public static final String ADMIN = "admin";
    }
}
