/* The one place that decides a reader may have the staff runbooks — lib/help.js takes that content
   as an argument rather than looking the role up itself. */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
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
import { helpPath, normalizeHelpLang } from './helpUrl.js';

/* i18next leaves a region tag in `language` ('en-US') while resolving resources against the bare
   code, so the raw value is not one of the three the content layer and URL builder accept. */
export function useHelpLang() {
  const { i18n } = useTranslation();
  return normalizeHelpLang(i18n.resolvedLanguage || i18n.language);
}

/* Every internal help link goes through this: hand-writing `/help/a/x` in a component drops a
   Marathi reader back into English on click, and that is invisible in English-only testing. */
export function useHelpPath() {
  const lang = useHelpLang();
  return useCallback((path) => helpPath(path, lang), [lang]);
}

/** `staff` is the empty set until the chunk arrives, so a staff account's first paint is public. */
function useHelpAudience() {
  const { user } = useAuth();
  const lang = useHelpLang();
  const staff = useSyncExternalStore(onStaffContent, getStaffContent, getStaffContent);
  const staffReader = isStaff(user);

  useEffect(() => {
    if (staffReader) loadStaffContent();
  }, [staffReader]);

  return {
    lang,
    staff: staffReader ? staff : undefined,
    pending: staffReader && !staff.loaded,
  };
}

/* `pending` is true only while a staff account waits for its chunk. Pages that would otherwise
   render "no such article" must honour it, or a runbook link reads as broken for half a second. */
export function useHelpTree() {
  const { lang, staff, pending } = useHelpAudience();
  const tree = useMemo(() => helpTree(lang, staff), [lang, staff]);
  return { ...tree, pending };
}

export function useHelpSearch(query, limit) {
  const { lang, staff } = useHelpAudience();
  return useMemo(() => searchHelp(query, { lang, limit, staff }), [query, lang, limit, staff]);
}

export function useFeaturedArticles(limit) {
  const { lang, staff } = useHelpAudience();
  return useMemo(() => featuredArticles(lang, limit, staff), [lang, limit, staff]);
}

export function useRecentArticles() {
  const { lang, staff } = useHelpAudience();
  return useMemo(() => recentArticles(lang, staff), [lang, staff]);
}

/** Previous/next within the article's own category. */
export function useArticleNeighbours(article) {
  const { lang, staff } = useHelpAudience();
  return useMemo(() => articleNeighbours(article, lang, staff), [article, lang, staff]);
}
