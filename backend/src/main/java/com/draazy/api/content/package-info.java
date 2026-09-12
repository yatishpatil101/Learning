/**
 * Content — public CMS surfaces: announcements, banners, FAQs and the CMS-managed service listings
 * shown on the marketing site and app home.
 *
 * <p><strong>Boundary (rank 0, {@code ArchitectureBoundaryTest} LAYER).</strong> A foundational
 * context that may import only the shared kernel ({@code common}, {@code security},
 * {@code provider}). It may not import any feature context — including its rank-0 peer
 * {@code identity} — because a same-rank or upward reference is exactly the cyclic edge the build
 * fails on. Higher contexts read content downward; content never reaches back up.
 */
package com.draazy.api.content;
