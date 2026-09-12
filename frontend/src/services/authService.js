/**
 * Auth Service — public API for authentication.
 *
 * The provider behind this is chosen per-domain (see `config.js`): `VITE_API_DOMAINS=auth` points
 * it at the live backend, anything else keeps it on the localStorage mock.
 */
import { createProvider } from './config.js';

const provider = createProvider('auth');

/** Step 1 of login/sign-up: dispatch an OTP to `mobile`. Resolves to `{ otpSent: true }`. */
export const sendOtp = async (data) => (await provider()).sendOtp(data);

/** Step 2: verify the OTP and open a session. Resolves to the signed-in user. */
export const login = async (data) => (await provider()).login(data);

/** Sign-up: same OTP verification, plus the display name/email captured on the form. */
export const register = async (data) => (await provider()).register(data);

export const staffLogin = async (data) => (await provider()).staffLogin(data);
export const logout = async () => (await provider()).logout();
export const getMe = async () => (await provider()).getMe();
export const updateMe = async (patch) => (await provider()).updateMe(patch);
export const exportMyData = async () => (await provider()).exportMyData();

/**
 * Ask for this account to be erased. Resolves to the filed request.
 *
 * Deliberately named a *request*: the server does not delete on receipt. Erasure is reviewed,
 * because an account can be the counterparty on a live tenancy or a payment somebody else is
 * relying on, and a self-service delete would take that record away from them too. The UI has to
 * say so — promising "deleted forever" and filing a ticket is the kind of gap that only shows up
 * when a user finds their data still there.
 */
export const requestErasure = async (data) => (await provider()).requestErasure(data);

/** The caller's own erasure requests, newest first. Used to show one already in flight. */
export const myErasureRequests = async () => (await provider()).myErasureRequests();
