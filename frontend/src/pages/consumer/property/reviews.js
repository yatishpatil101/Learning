const REVIEWS_KEY = 'draazyPropReviews';
export const SOCIETY_NAMES = ['Skyline Heights', 'Green Meadows', 'Silver Oak Residency', 'Marvel Fria', 'Kumar Palaash', 'Nyati Elysia', 'Amanora Park', 'Blue Ridge Towers'];

export function loadReviews(propId) {
  try {
    const all = JSON.parse(localStorage.getItem(REVIEWS_KEY)) || {};
    return Array.isArray(all[propId]) ? all[propId] : [];
  } catch { return []; }
}
export function saveReview(propId, review) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(REVIEWS_KEY)) || {}; } catch { all = {}; }
  const list = Array.isArray(all[propId]) ? all[propId] : [];
  all[propId] = [review, ...list];
  localStorage.setItem(REVIEWS_KEY, JSON.stringify(all));
}
