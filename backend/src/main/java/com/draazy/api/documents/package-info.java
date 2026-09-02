/**
 * Documents — the property document vault, buyer access requests and secure share links, plus rent
 * agreements: the paperwork analogue of a lead, an outsider asking an owner for something and the
 * owner deciding.
 *
 * <p><strong>Boundary (rank 2, {@code ArchitectureBoundaryTest} LAYER).</strong> A join context
 * over {@code catalog} (1) and {@code identity} (0), which it may import downward along with the
 * shared kernel. It may not import its rank-2 peers {@code leads}, {@code engagement} and
 * {@code billing}, nor anything above — a same-rank reference is the cycle the build fails on. To
 * notify a user it uses the {@code common.trust.Notifier} port ({@code engagement} implements it),
 * never a direct import of {@code engagement}.
 */
package com.draazy.api.documents;
