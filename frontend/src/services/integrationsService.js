import { createProvider } from './config.js';

const provider = createProvider('integrations');

export const getProviderHealth = async () => (await provider()).getProviderHealth();

export const listProviderCalls = async (opts) => (await provider()).listProviderCalls(opts);
