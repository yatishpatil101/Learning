import { BUDGET_MIN, BUDGET_MAX } from './helpers.js';

/* Panel state and search request are separate on purpose: the request is the cache key, so
   anything that cannot change the answer (`nearLabel`, a pin's display name) stays out of it. */

/** Answers `undefined`, not `null` like `helpers.budgetOf`, because these values become
    query params and an absent one must not be serialised. */
const budgetOf = (x) => {
  if (!x) return undefined;
  if (x.budget != null) return Number(x.budget);
  if (x.rent != null) return Math.round(Number(x.rent) / (x.seatsTotal || 1));
  return undefined;
};

/* Undefined rather than empty values when there is nothing to compare to: an empty comparison
   scores every row alike, which is an arbitrary order wearing the name of a ranking. */
const meFacets = (myPost) => {
  if (!myPost) return undefined;
  const localities = myPost.localities?.length
    ? myPost.localities
    : (myPost.locality ? [myPost.locality] : undefined);
  const budget = budgetOf(myPost);
  const gender = myPost.gender || undefined;
  if (!localities && budget === undefined && !gender) return undefined;
  return { localities, budget, gender };
};

/* Every field here reaches the server and nothing is re-filtered in the browser: two predicates
   over one field intersect to the narrower, silently discarding what the server just matched. */
export default function toFlatmateQuery(filters = {}, { sort, myPost = null } = {}) {
  const [lo, hi] = filters.budget || [];
  return {
    q: filters.q || undefined,
    locality: filters.locality || undefined,
    // Untouched ends are dropped rather than sent as the extremes of the slider: "from ₹0" is not
    // a filter, and "to ₹40,000" would exclude the handful of rooms priced above the scale.
    budget: (lo > BUDGET_MIN || hi < BUDGET_MAX) ? [lo, hi] : undefined,
    moveIn: filters.moveIn || undefined,
    gender: filters.gender || undefined,
    sharing: filters.sharing || undefined,
    verifiedOnly: filters.verifiedOnly || undefined,
    attachedBath: filters.attachedBath || undefined,
    habits: filters.habits?.length ? [...filters.habits] : undefined,
    near: filters.near || undefined,
    nearRadius: filters.near ? filters.nearRadius : undefined,
    nearMode: filters.near ? filters.nearMode : undefined,
    sort: sort || undefined,
    me: sort === 'match' ? meFacets(myPost) : undefined,
  };
}
