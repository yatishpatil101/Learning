import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import MyPostsStrip from '../../../components/MyPostsStrip.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import useAsyncList from '../../../hooks/useAsyncList.js';
import { myListings } from '../../../services/propertyService.js';
import { fmtINR } from '../../../lib/format.js';

const SHOWN_STATUS = new Set(['approved', 'pending']);

export default function MyListingsStrip({ deal }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const load = useCallback(() => myListings(user), [user]);
  const [mine] = useAsyncList(load, [load], !!user);
  const isRent = deal === 'rent';
  const items = mine
    .filter((l) => !l.archived && SHOWN_STATUS.has(l.status) && l.dealStatus === 'active' && (l.deal === 'rent') === isRent)
    .map((l) => ({
      id: l.id,
      to: '/property/' + l.id,
      pending: l.status === 'pending',
      label: t('common.myPostsYourListing') + ' · ' + t(l.status === 'pending' ? 'common.myPostsInReview' : 'common.myPostsLive'),
      title: l.title,
      sub: [isRent ? '₹' + (l.price || 0).toLocaleString('en-IN') + t('listings.perMonth') : fmtINR(l.price), l.locality].filter(Boolean).join(' · '),
    }));
  return <MyPostsStrip items={items} viewAllHref="/dashboard#listings" />;
}
