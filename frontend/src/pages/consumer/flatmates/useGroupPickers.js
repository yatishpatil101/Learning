import useAsyncList from '../../../hooks/useAsyncList.js';
import { toRentalCards } from '../../../lib/data/tenancy.js';
import * as propertyService from '../../../services/propertyService.js';
import * as rentService from '../../../services/rentService.js';

const isApproved = (listing) => /approved|verified|live/i.test(String(listing?.status || ''));

export function useGroupPickers(user, groupOpen, { onlyWhileOpen = false } = {}) {
  const enabled = !!user && (!onlyWhileOpen || groupOpen);
  const [myApprovedListings, myApprovedListingsStatus, , retryMyApprovedListings, myApprovedListingsError] = useAsyncList(
    () => propertyService.myListings(user).then((list) => list.filter(isApproved)),
    [user?.mobile, groupOpen],
    enabled,
  );
  const [myTenancies, myTenanciesStatus, , retryMyTenancies, myTenanciesError] = useAsyncList(
    () => rentService.myTenancies()
      .then((list) => list.filter((tenancy) => tenancy.status !== 'ended'))
      .then(toRentalCards),
    [user?.mobile, groupOpen],
    enabled,
  );
  return {
    myApprovedListings, myApprovedListingsStatus, retryMyApprovedListings, myApprovedListingsError,
    myTenancies, myTenanciesStatus, retryMyTenancies, myTenanciesError,
  };
}
