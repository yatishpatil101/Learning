/**
 * The caller's person-level verification state (`GET`/`POST /me/verification/identity`). A badge,
 * never a wall (ADR-019); submission answers 202 because only a staff decision flips the badge.
 */
import { createProvider } from './config.js';

const provider = createProvider('verification');

/** Signed-out / never-attempted reads as the `none` tier. */
export const getAadhaarStatus = async () => (await provider()).getAadhaarStatus();

/** Submit captured images for staff review. */
export const submitIdentityVerification = async (details) => (await provider()).submitIdentityVerification(details);

/** Local-only simulation for tests and dev flows. */
export const simulateIdentityVerification = async (outcome) => (await provider()).simulateIdentityVerification(outcome);
