import { createProvider } from './config.js';

const provider = createProvider('erasure');

export const listErasureRequests = async (opts) => (await provider()).listErasureRequests(opts);

export const decideErasureRequest = async (id, decision, note) => (await provider()).decideErasureRequest(id, decision, note);
