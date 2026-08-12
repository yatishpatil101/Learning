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
