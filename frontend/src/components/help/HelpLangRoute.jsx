import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { splitLangPrefix } from '../../lib/helpUrl.js';

/* Binds the help centre's URL prefix to the active language.
 *
 * Without this, /mr/help/a/x would render in whatever language the visitor's
 * device preference happened to select — so the URL would promise Marathi and
 * deliver English, which is worse than having no prefix at all. A shared link
 * has to be self-describing.
 *
 * Direction is deliberately one-way: the URL wins. The reverse (language change
 * rewrites the URL) is handled by the language switcher, which knows it is a
 * user action; doing it here as well would make the two fight during the render
 * that follows a switch.
 *
 * The change is scoped to the help centre and persists device-wide afterwards,
 * matching how i18n/index.js treats language as a single device-level pref. That
 * is the intended behaviour: someone who opens a Marathi help link has told us
 * something about which language they want.
 */

export default function HelpLangRoute() {
  const { pathname } = useLocation();
  const { i18n } = useTranslation();
  const { lang } = splitLangPrefix(pathname);

  useEffect(() => {
    const current = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
    if (lang !== current) i18n.changeLanguage(lang);
  }, [lang, i18n]);

  return <Outlet />;
}
