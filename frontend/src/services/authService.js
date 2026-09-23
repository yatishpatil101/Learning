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

// The server files a request and does not delete on receipt — erasure is reviewed, because an
// account can be the counterparty on a live tenancy. The UI must not promise "deleted forever".
export const requestErasure = async (data) => (await provider()).requestErasure(data);

/** The caller's own erasure requests, newest first. Used to show one already in flight. */
export const myErasureRequests = async () => (await provider()).myErasureRequests();
