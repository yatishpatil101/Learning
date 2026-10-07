/** The read-only demand console: contact requests, visits and deals. `getEnquiry` / `getVisit` / `getDeal` are audited server-side; the lists are not. */
import { createProvider } from './config.js';

const provider = createProvider('enquiryBoard');

export async function listEnquiries(params) {
  return (await provider()).listEnquiries(params);
}

export async function listVisits(params) {
  return (await provider()).listVisits(params);
}

export async function listDeals(params) {
  return (await provider()).listDeals(params);
}

export async function getEnquiry(id) {
  return (await provider()).getEnquiry(id);
}

export async function getVisit(id) {
  return (await provider()).getVisit(id);
}

export async function getDeal(id) {
  return (await provider()).getDeal(id);
}
