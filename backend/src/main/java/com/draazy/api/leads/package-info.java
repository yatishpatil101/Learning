/**
 * Leads &amp; Contact — gated contact requests, buyer/owner conversations and society leads: an
 * outsider asking an owner for contact, and the owner deciding.
 *
 * <p><strong>Boundary (rank 2, {@code ArchitectureBoundaryTest} LAYER).</strong> A join context
 * over {@code catalog} (1) and {@code identity} (0), which it reads downward (including
 * {@code PropertyRepository}/{@code UserRepository} for read-only lookups) along with the shared
 * kernel. It may not import its rank-2 peers {@code documents}, {@code engagement} and
 * {@code billing}, nor anything above. It <em>implements</em> the shared-kernel port
 * {@code common.trust.ContactGate} so {@code catalog} can mask contacts without importing
 * {@code leads}, and it reaches {@code engagement} notifications only through
 * {@code common.trust.Notifier}.
 */
package com.draazy.api.leads;
