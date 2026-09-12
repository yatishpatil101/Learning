package com.draazy.api.common.access;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Per-account back-office permission documents, keyed by {@code users.id}.
 *
 * <p>Deliberately offers nothing beyond {@link JpaRepository}'s primary-key operations. Every read
 * on the authorisation path is {@code findById(principal.userId())} — one indexed lookup on a table
 * with a row per scoped ops account — and there is no query here that takes a value from the
 * request, because the only key this document may ever be selected by is the one on the
 * signature-verified principal (V61, V65).
 */
public interface BackOfficeGrantRepository extends JpaRepository<BackOfficeGrant, UUID> {
}
