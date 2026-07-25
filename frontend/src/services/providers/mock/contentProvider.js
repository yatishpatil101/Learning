/**
 * Mock content provider — wraps mockApi.js collection getters
 */
import {
  listEnquiries,
  listVisits,
  listDeals,
  listLocalities,
  listServices,
  listReviews,
  listReports,
  listReferrals,
  listAnnouncements,
  listPlans,
  listReels,
  listNotifications,
  listMessages,
  getFaqs,
  getBanners,
  getLocality,
} from '../../../lib/mockApi.js';

// All already async (return Promises)
export {
  listEnquiries,
  listVisits,
  listDeals,
  listLocalities,
  listServices,
  listReviews,
  listReports,
  listReferrals,
  listAnnouncements,
  listPlans,
  listReels,
  listNotifications,
  listMessages,
  getFaqs,
  getBanners,
  getLocality,
};
