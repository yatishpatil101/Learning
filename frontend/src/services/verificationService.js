/** A badge, never a wall; submission answers 202 because only a staff decision flips the badge. */
import { createProvider } from './config.js';

const provider = createProvider('verification');

/** Signed-out / never-attempted reads as the `none` tier. */
export const getAadhaarStatus = async () => (await provider()).getAadhaarStatus();

export const getIdentityChallenge = async () => (await provider()).getIdentityChallenge();

/** Submit captured images for staff review. */
export const submitIdentityVerification = async (details) => (await provider()).submitIdentityVerification(details);

export const disputeIdentityVerification = async (details) => (await provider()).disputeIdentityVerification(details);

export const withdrawIdentityVerification = async () => (await provider()).withdrawIdentityVerification();

/** Local-only simulation for tests and dev flows. */
export const simulateIdentityVerification = async (outcome) => (await provider()).simulateIdentityVerification(outcome);
