/* The one place that decides a reader may have the staff runbooks — lib/help.js takes that content
   as an argument rather than looking the role up itself. */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import {
  helpTree,
  searchHelp,
  featuredArticles,
  recentArticles,
  articleNeighbours,
  isStaff,
  loadStaffContent,
  getStaffContent,
  onStaffContent,
} from './help.js';

/** `staff` is the empty set until the chunk arrives, so a staff account's first paint is public. */
function useHelpAudience() {
  const { user } = useAuth();
  const staff = useSyncExternalStore(onStaffContent, getStaffContent, getStaffContent);
  const staffReader = isStaff(user);

  useEffect(() => {
    if (staffReader) loadStaffContent();
  }, [staffReader]);

  return {
    staff: staffReader ? staff : undefined,
    pending: staffReader && !staff.loaded,
  };
}

/* `pending` is true only while a staff account waits for its chunk. Pages that would otherwise
   render "no such article" must honour it, or a runbook link reads as broken for half a second. */
export function useHelpTree() {
  const { staff, pending } = useHelpAudience();
  const tree = useMemo(() => helpTree(staff), [staff]);
  return { ...tree, pending };
}

export function useHelpSearch(query, limit) {
  const { staff } = useHelpAudience();
  return useMemo(() => searchHelp(query, { limit, staff }), [query, limit, staff]);
}

export function useFeaturedArticles(limit) {
  const { staff } = useHelpAudience();
  return useMemo(() => featuredArticles(limit, staff), [limit, staff]);
}

export function useRecentArticles() {
  const { staff } = useHelpAudience();
  return useMemo(() => recentArticles(staff), [staff]);
}

/** Previous/next within the article's own category. */
export function useArticleNeighbours(article) {
  const { staff } = useHelpAudience();
  return useMemo(() => articleNeighbours(article, staff), [article, staff]);
}