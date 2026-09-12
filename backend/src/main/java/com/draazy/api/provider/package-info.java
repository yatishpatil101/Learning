/**
 * Shared kernel — external-world seams: the abstractions for OTP delivery, KYC, the payment gateway
 * and file storage, each with a mock-in-dev implementation and a real adapter (e.g. Cashfree).
 *
 * <p><strong>Boundary ({@code ArchitectureBoundaryTest} SHARED_KERNEL).</strong> Part of the shared
 * kernel and imported by feature contexts, so it may <em>never</em> import a feature context. It
 * exposes provider-neutral interfaces only; a context depends on the seam, not on any vendor SDK or
 * on another context.
 */
package com.draazy.api.provider;
