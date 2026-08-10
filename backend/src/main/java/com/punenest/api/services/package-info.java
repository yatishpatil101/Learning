/**
 * Services &amp; Support — the assisted-service workflow (service requests, owner KYC, rent-agreement
 * drafting) and support tickets: staff doing work on a user's behalf.
 *
 * <p><strong>Boundary (rank 3, {@code ArchitectureBoundaryTest} LAYER).</strong> Reads down into
 * {@code documents} (2, a draft and its registered copy are vault rows), {@code catalog} (1) and
 * {@code identity} (0), plus the shared kernel; it touches neither {@code finance} nor {@code deals}
 * — the assisted-service workflow and the rent ledger never interact. It sits below {@code finance}
 * (4) so that {@code finance}'s payment webhook can settle a paid draft via {@code finance -> services};
 * anything at rank 3 or above must not be imported.
 */
package com.punenest.api.services;
