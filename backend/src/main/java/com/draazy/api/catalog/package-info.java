/**
 * Catalog &amp; Listings — the "which listing": public discovery (filters, map, cities, localities,
 * fees) and the owner listing lifecycle (properties, societies, photos, reels, managed listings).
 *
 * <p><strong>Boundary (rank 1, {@code ArchitectureBoundaryTest} LAYER).</strong> May import the
 * shared kernel and rank-0 contexts ({@code identity} for the owner, {@code content}), and nothing
 * at rank 1 or above ({@code documents}, {@code leads}, {@code engagement}, {@code billing},
 * {@code finance}, {@code services}, {@code deals}, {@code moderation}, {@code admin}) — such an
 * import is upward and cyclic. The security-critical contact reveal is one such upward need and is
 * satisfied without importing {@code leads}: catalog depends on the {@code common.trust.ContactGate}
 * port, which {@code leads} implements.
 */
package com.draazy.api.catalog;
