import MyListingsPanel from './MyListingsPanel.jsx';
import RentOMeter from '../owner-hub/RentOMeter.jsx';

/* "My Properties" — one surface, one source of truth. */
export default function MyPropertiesPanel({ listings, setListings, managed, onManagedChanged, user, toast, REVIEW_STATUS, openReview, reviewsByProp, onChanged }) {
  return (
    <div className="space-y-6">
      <MyListingsPanel listings={listings} setListings={setListings} managed={managed} onManagedChanged={onManagedChanged} user={user} toast={toast} REVIEW_STATUS={REVIEW_STATUS} openReview={openReview} reviewsByProp={reviewsByProp} onChanged={onChanged} />

      <div className="dash-tools-row grid grid-cols-1 gap-6 items-start">
        {/* Rent-o-meter — "add / value a property" */}
        <div id="rent-o-meter" tabIndex={-1} className="scroll-mt-24 outline-none"><RentOMeter /></div>
      </div>
    </div>
  );
}
