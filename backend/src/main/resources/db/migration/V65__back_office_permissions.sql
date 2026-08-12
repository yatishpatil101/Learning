-- D192/D13: give a single back-office account a permission document of its own, and make it a
-- subtraction rather than a grant.
--
-- WHAT WAS MISSING. V61 deleted `settings.customRoles` rather than wiring it, and its header names
-- the three things that had to exist first. Two of them are answered here and one is answered in
-- Java:
--
--   1. A KEY TO RESOLVE A DOCUMENT AGAINST. There was no `users.role_id`, no claim and no endpoint,
--      so a bundle could only ever have been selected by something the client sent -- "an allow-list
--      the client opts out of". This table is keyed by `user_id`, which is the `sub` of a
--      signature-verified token and the one thing on the principal a caller cannot choose. No
--      request parameter, header or body field takes part in selecting a row.
--   2. A SERVER-SIDE VOCABULARY. `customRoles` held the admin console's module keys (`enquiries`,
--      `properties:verify`) and nothing mapped them onto anything the server enforces. The entries
--      stored here are drawn from `security/BackOfficePermissions`, a catalogue where every name
--      exists because a route is annotated with it -- and the write endpoint rejects a name that is
--      not in it (422) rather than storing it to look meaningful. The frontend's keys are NOT
--      mapped; inventing that mapping is still "writing policy nobody agreed".
--   3. DIRECTION. `customRoles` composed by union (`BASE u role-bundle u moduleAccess`). This
--      document is resolved by `security/AccountPermissions` as `retainAll` against a compiled-in
--      role baseline, so the resolved set is a SUBSET of the baseline by construction. There is no
--      value an administrator can put in this column that adds anything.
--
-- WHY A TABLE AND NOT A COLUMN ON `users`. Two reasons, and the second is the load-bearing one.
-- First, absence has to mean something: no row is "this account is not scoped", which is every
-- account today and must stay a no-op -- a nullable column would have said the same thing less
-- clearly, but only just. Second, the resolver lives in the shared kernel (`security`), which
-- `docs/system/package-structure.md` §2 forbids from importing a feature context -- and `users` is
-- `identity`'s table. A kernel-owned table with a kernel-owned repository keeps the resolution
-- entirely inside the kernel instead of smuggling an `identity` read into it, which is the same
-- reason `User implements TokenSubject` rather than `JwtService` importing `User`.
--
-- WHY NOT IN THE JWT. A capability set embedded in a signed token is an allow-list the holder
-- carries: narrowing somebody's access would not take effect until their token expired, and every
-- issued token would be a standing snapshot of a policy that has since changed. Server-side lookup
-- makes a revocation take effect on the next request, which is what an access control that exists
-- to be used in an incident has to do. The token shape is deliberately unchanged by this migration
-- -- it still carries identity and the coarse role, exactly as V61's warning about client-selected
-- bundles requires.
--
-- WHY THE VALUE IS A JSON ARRAY RATHER THAN A JOIN TABLE. The document is read whole, on every
-- request, for one user, and is never queried across users -- "who holds tickets:write" is a report
-- nobody has asked for. A row per grant would turn one primary-key lookup into a join for no gain
-- and would make "granted nothing" indistinguishable from "not scoped", which is precisely the
-- distinction the resolver turns on. The CHECK below is what stops the column from holding a shape
-- the resolver would have to guess at; see the fail-closed note on `permissions`.
--
-- Seeds nothing. On every existing deployment this table is empty on the morning after deploy, and
-- an empty table means every back-office account keeps exactly the access it had -- which is the
-- only safe way to introduce an access-control mechanism into a running platform.

CREATE TABLE back_office_permissions (
    user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    permissions jsonb       NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT back_office_permissions_is_array CHECK (jsonb_typeof(permissions) = 'array')
);

COMMENT ON TABLE back_office_permissions IS
    'Per-account narrowing of back-office access (D192/D13). One row scopes one staff or admin '
    'account; NO ROW is the normal state and means "not scoped -- the compiled-in role baseline '
    'applies". Resolved per request by security/AccountPermissions, which intersects this document '
    'with the baseline for the caller''s role, so the row can only ever subtract. It is never '
    'consulted instead of a @PreAuthorize role guard, only in addition to one.';

COMMENT ON COLUMN back_office_permissions.user_id IS
    'The account this document scopes. Also the primary key: an account has one permission document '
    'or none. Selected from the JWT ''sub'' of the signature-verified principal and from nothing '
    'else -- a document addressed by anything the client sends would be an allow-list the client '
    'could opt out of (V61).';

COMMENT ON COLUMN back_office_permissions.permissions IS
    'JSON array of "module:action" atoms from security/BackOfficePermissions, e.g. '
    '["tickets:read","tickets:write","users:read"]. Names outside that catalogue are refused by the '
    'write endpoint with 422 rather than stored, so this column cannot accumulate the kind of '
    'inert, meaningful-looking policy that V61 had to delete. An empty array is legal and means '
    '"this account may reach no guarded back-office route"; that is a deliberate state, which is '
    'why it is distinguished from having no row at all. A value the resolver cannot read as an '
    'array of strings DENIES everything for this one account rather than falling back to the '
    'baseline -- unlike settings.permissions, whose fallback is platform-wide and whose absence '
    'must not be able to take the back office down, a malformed row here can only arrive by direct '
    'database edit and can only affect the one account it names.';

COMMENT ON COLUMN back_office_permissions.updated_by IS
    'The administrator who last wrote this document. Nullable and ON DELETE SET NULL: the record of '
    'who scoped an account must survive that administrator''s own account being removed, and losing '
    'the attribution is a smaller loss than losing the scoping.';
