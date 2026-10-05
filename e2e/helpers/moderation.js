import { expect } from '@playwright/test';
import { API, authHeaders } from './liveAuth.js';
import { ACTORS, STAFF } from '../fixtures/live.js';

export const REVIEW_CHECKLIST = [
  'Photos are real and match the listing',
  'Not a duplicate of another listing',
  'Details and location look right',
];

export async function tickChecklist(request, id, headers, { api = API } = {}) {
  const opened = await request.post(`${api}/properties/${id}/verification/start`, { headers });
  expect(opened.status(), await opened.text()).toBe(200);
  for (const item of REVIEW_CHECKLIST) {
    const ticked = await request.patch(`${api}/properties/${id}/verification/checklist`, {
      headers,
      data: { item, pass: true },
    });
    expect(ticked.status(), await ticked.text()).toBe(200);
  }
}

async function jsonResult(res) {
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}

async function assertOk(res, label) {
  expect(res.status, `${label}: ${res.text}`).toBe(200);
}

export async function tickChecklistWithFetch(id, headers, { api = API } = {}) {
  await assertOk(await jsonResult(await fetch(`${api}/properties/${id}/verification/start`, {
    method: 'POST',
    headers,
  })), `opening review ${id}`);

  for (const item of REVIEW_CHECKLIST) {
    await assertOk(await jsonResult(await fetch(`${api}/properties/${id}/verification/checklist`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ item, pass: true }),
    })), `ticking ${item}`);
  }
}

const subjectOf = (headers) =>
  JSON.parse(Buffer.from(headers.authorization.split(' ')[1].split('.')[1], 'base64url').toString()).sub;

async function checkerFor(makerHeaders) {
  const staff = await authHeaders(STAFF.rental);
  return subjectOf(staff) === subjectOf(makerHeaders) ? authHeaders(ACTORS.admin) : staff;
}

async function overrideWithFetch(id, headers, api) {
  const filed = await jsonResult(await fetch(`${api}/properties/${id}/verification/override-requests`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason: 'e2e fixture reuses shared test photos and addresses' }),
  }));
  expect(filed.status, `filing override for ${id}: ${filed.text}`).toBe(201);
  return jsonResult(await fetch(
    `${api}/properties/${id}/verification/override-requests/${filed.json.overrideRequest.id}/approve`,
    { method: 'POST', headers: await checkerFor(headers), body: JSON.stringify({}) },
  ));
}

export async function approveListing(request, id, headers, { reason, api = API } = {}) {
  await tickChecklist(request, id, headers, { api });
  const res = await request.patch(`${api}/properties/${id}/status`, {
    headers,
    data: { status: 'approved', ...(reason ? { reason } : {}) },
  });
  if (res.status() !== 409 || !(await res.text()).includes('second_approver_required')) return res;
  const filed = await request.post(`${api}/properties/${id}/verification/override-requests`, {
    headers,
    data: { reason: 'e2e fixture reuses shared test photos and addresses' },
  });
  expect(filed.status(), `filing override for ${id}: ${await filed.text()}`).toBe(201);
  const { overrideRequest } = await filed.json();
  return request.post(`${api}/properties/${id}/verification/override-requests/${overrideRequest.id}/approve`, {
    headers: await checkerFor(headers),
    data: {},
  });
}

export async function approveListingWithFetch(id, headers, { reason, api = API } = {}) {
  await tickChecklistWithFetch(id, headers, { api });
  const res = await jsonResult(await fetch(`${api}/properties/${id}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'approved', ...(reason ? { reason } : {}) }),
  }));
  if (res.status !== 409 || !res.text.includes('second_approver_required')) return res;
  return overrideWithFetch(id, headers, api);
}

export async function rejectListing(request, id, headers, { reasonCode = 'wrong_details', reason, api = API } = {}) {
  return request.patch(`${api}/properties/${id}/status`, {
    headers,
    data: { status: 'rejected', reasonCode, ...(reason ? { reason } : {}) },
  });
}

export async function rejectListingWithFetch(
  id,
  headers,
  { reasonCode = 'wrong_details', reason, api = API } = {},
) {
  return jsonResult(await fetch(`${api}/properties/${id}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'rejected', reasonCode, ...(reason ? { reason } : {}) }),
  }));
}

export async function publishFlatmate(id, { api = API } = {}) {
  const res = await jsonResult(await fetch(`${api}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: await authHeaders(STAFF.rental),
    body: JSON.stringify({ modStatus: 'approved' }),
  }));
  expect(res.status, `publishing flatmate post ${id}: ${res.text}`).toBe(200);
  return res.json;
}
