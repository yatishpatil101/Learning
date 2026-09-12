/**
 * Engagement — saved searches and alerts, reviews, flatmate posts, follows and the notification
 * feed: everything that keeps a user coming back after the listing is found.
 *
 * <p><strong>Boundary (rank 2, {@code ArchitectureBoundaryTest} LAYER).</strong> May read
 * {@code catalog} (1) and {@code identity} (0) downward plus the shared kernel; it may not import
 * its rank-2 peers {@code documents}, {@code leads} and {@code billing}, nor anything above. Because
 * same-rank and higher contexts may not import it, it exposes notification delivery through the
 * shared-kernel port {@code common.trust.Notifier} — {@code engagement.notification} is the
 * implementation, and callers such as {@code leads} and {@code documents} depend on the port.
 */
package com.draazy.api.engagement;
