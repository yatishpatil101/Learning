import Icon from '../../../components/Icon.jsx';
import MyListingsPanel from './MyListingsPanel.jsx';
import RentOMeter from '../owner-hub/RentOMeter.jsx';

const TOOLS = [
  { icon: 'gauge', title: 'Know its worth', desc: 'Instant rent & sale estimates, updated with locality trends.' },
  { icon: 'folder-lock', title: 'Property passport', desc: 'Keep deeds, tax receipts & agreements safe in one private vault.' },
  { icon: 'receipt-indian-rupee', title: 'Rent on track', desc: 'Due-date reminders and one-tap HRA rent receipts for your tenant.' },
];

/* "My Properties" — one surface, one source of truth. Every property the owner
   has (private Rent-o-meter saves + posted listings) lives in a single unified
   list, each showing its status (Private / Under review / Live / Rented / Sold)
   and passport progress. The Rent-o-meter is the "add / value a property" tool,
   not a rival list. Visible to everyone: the tools are the acquisition wedge for
   not-yet-owners, and flatmate posters manage their posts here too. */
export default function MyPropertiesPanel({ listings, user, toast, REVIEW_STATUS, openReview, reviewsByProp }) {
  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-teal-1/15 border border-brand-teal-2/25 text-brand-teal-3 text-xs font-medium"><Icon name="home" className="w-3.5 h-3.5" /> For owners</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-bold text-white">Your property, working for you</h1>
        <p className="text-gray-400 text-sm mt-1.5 max-w-2xl">Value it, organise its papers, and stay on top of rent — all in one place. List to buyers only when you're ready. It's free.</p>
      </div>

      <MyListingsPanel listings={listings} user={user} toast={toast} REVIEW_STATUS={REVIEW_STATUS} openReview={openReview} reviewsByProp={reviewsByProp} />

      <div className="dash-tools-row grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Rent-o-meter — "add / value a property" */}
        <div id="rent-o-meter" tabIndex={-1} className="scroll-mt-24 outline-none"><RentOMeter /></div>

        <section className="glass-card rounded-2xl p-6">
          <h2 className="text-lg font-bold text-white mb-4">Why owners register here</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {TOOLS.map((t) => (
              <div key={t.title} className="flex flex-col items-start gap-2">
                <span className="w-9 h-9 rounded-lg bg-brand-teal/10 flex items-center justify-center"><Icon name={t.icon} className="w-5 h-5 text-brand-teal-3" /></span>
                <div>
                  <p className="text-white text-sm font-semibold">{t.title}</p>
                  <p className="text-gray-400 text-[12px] leading-relaxed mt-0.5">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
