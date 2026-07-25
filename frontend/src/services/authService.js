/**
 * Auth Service — public API for authentication.
 */
import { createProvider } from './config.js';

const provider = createProvider('auth');

export const login = (data) => provider().login(data);
export const staffLogin = (data) => provider().staffLogin(data);
export const logout = () => provider().logout();
export const getMe = () => provider().getMe();
export const updateMe = (patch) => provider().updateMe(patch);
