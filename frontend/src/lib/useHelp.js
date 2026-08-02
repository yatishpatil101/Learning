/* React bindings for the help centre data layer.
 *
 * Every help page needs the same three things — the signed-in user (for staff
 * gating), the active language, and the resulting content tree. Without this
 * hook each page repeats that wiring, and it only takes one page forgetting to
 * pass `i18n.language` for a Marathi reader to get an English section heading
 * with Marathi articles under it.
 */

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.jsx';
import {
  helpTree,
  searchHelp,
  featuredArticles,
  recentArticles,
} from './help.js';
import { helpPath } from './helpUrl.js';

/** The active help language, normalised to one the content layer knows. */
export function useHelpLang() {
  const { i18n } = useTranslation();
  return i18n.language || 'en';
}

/**
 * Build help URLs in the active language.
 *
 * Every internal help link goes through this. Hand-writing `/help/a/x` inside a
 * component drops a Marathi reader back into English on click, and that bug is
 * invisible in English-only testing — which is why the raw path never appears in
 * a component.
 */
export function useHelpPath() {
  const lang = useHelpLang();
  return useCallback((path) => helpPath(path, lang), [lang]);
}

/** Sections, categories and articles visible to the current user, in their language. */
export function useHelpTree() {
  const { user } = useAuth();
  const lang = useHelpLang();
  return useMemo(() => helpTree(user, lang), [user, lang]);
}

export function useHelpSearch(query, limit) {
  const { user } = useAuth();
  const lang = useHelpLang();
  return useMemo(() => searchHelp(query, user, { lang, limit }), [query, user, lang, limit]);
}

export function useFeaturedArticles(limit) {
  const { user } = useAuth();
  const lang = useHelpLang();
  return useMemo(() => featuredArticles(user, lang, limit), [user, lang, limit]);
}

export function useRecentArticles() {
  const { user } = useAuth();
  const lang = useHelpLang();
  return useMemo(() => recentArticles(user, lang), [user, lang]);
}
