/**
 * Shared kernel — cross-cutting machinery every context depends on: error model and global handler,
 * base JPA entities (audited, soft-delete), web utilities (paging, correlation id), audit log,
 * validation, settings, payment abstractions, and the {@code trust} ports that invert upward
 * dependencies ({@code ContactGate}, {@code Notifier}, {@code PropertyExperience},
 * {@code RatingLookup}, {@code MobileMask}).
 *
 * <p><strong>Boundary ({@code ArchitectureBoundaryTest} SHARED_KERNEL).</strong> This package is
 * imported by everything, so it may <em>never</em> import a feature context — doing so would create
 * a cycle through the kernel and make that feature un-removable. When a feature needs a capability
 * the kernel triggers, the kernel declares a port here and the feature implements it (the pattern
 * behind {@code common.trust.ContactGate}).
 */
package com.punenest.api.common;
