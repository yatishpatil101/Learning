/**
 * Auth Service — public API for authentication.
 *
 * The provider behind this is chosen per-domain (see `config.js`): `VITE_API_DOMAINS=auth` points
 * it at the live backend, anything else keeps it on the localStorage mock.
 */
import { createProvider } from './config.js';

const provider = createProvider('auth');

/** Step 1 of login/sign-up: dispatch an OTP to `mobile`. Resolves to `{ otpSent: true }`. */
export const sendOtp = (data) => provider().sendOtp(data);

/** Step 2: verify the OTP and open a session. Resolves to the signed-in user. */
export const login = (data) => provider().login(data);

/** Sign-up: same OTP verification, plus the display name/email captured on the form. */
export const register = (data) => provider().register(data);

export const staffLogin = (data) => provider().staffLogin(data);
export const logout = () => provider().logout();
export const getMe = () => provider().getMe();
export const updateMe = (patch) => provider().updateMe(patch);
