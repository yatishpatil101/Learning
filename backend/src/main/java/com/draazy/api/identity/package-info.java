/**
 * Identity &amp; Access — the "who" of the platform: authentication (OTP and staff password),
 * refresh sessions, user profiles and RBAC, and the Aadhaar/KYC verification badge.
 *
 * <p><strong>Boundary (rank 0, {@code ArchitectureBoundaryTest} LAYER).</strong> This is a
 * foundational context: it may import only the shared kernel ({@code common}, {@code security},
 * {@code provider}) and no feature context — every feature sits at the same rank or above it, so
 * any such import would be an upward or cyclic edge the build fails on. Other contexts read
 * {@code identity.user} downward to resolve "who"; when {@code identity} needs something a higher
 * context owns, it goes through an event or a {@code common.*} port, never a direct call.
 */
package com.draazy.api.identity;
