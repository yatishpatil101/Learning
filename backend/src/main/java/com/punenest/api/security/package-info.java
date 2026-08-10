/**
 * Shared kernel — the security chain: JWT issuing and filtering, the authenticated principal and
 * {@code @CurrentUser} resolution, role/team guards, entry-point and access-denied handlers, and
 * write rate limiting.
 *
 * <p><strong>Boundary ({@code ArchitectureBoundaryTest} SHARED_KERNEL).</strong> Part of the shared
 * kernel, imported by every feature context, so it may <em>never</em> import a feature context — an
 * import here creates a cycle through the kernel. It carries only the identity of the caller (roles,
 * subject id), never a feature's model.
 */
package com.punenest.api.security;
