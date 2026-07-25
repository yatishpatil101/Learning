import { useNavigate } from 'react-router';
import Icon from '../Icon.jsx';
import { useCity } from '../../context/CityContext.jsx';

/* Honest "launched but empty" state for a live city we don't have inventory for yet
   (everything except Pune today). Shown instead of leaking Pune content when the active
   city has no data. Keeps the platform's trust promise: never mislabel Pune homes as
   belonging to another city. `context` tailors the headline (home hero vs. listings). */
export default function NewCityEmptyState({ city, context = 'listings' }) {
  const navigate = useNavigate();
  const { setCity } = useCity();

  const headline =
    context === 'home'
      ? `PuneNest just launched in ${city}`
      : `No listings in ${city} yet`;

  return (
    <div className="glass rounded-2xl p-8 sm:p-12 text-center max-w-2xl mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-teal-500/15 border border-teal-400/25 flex items-center justify-center mx-auto mb-5">
        <Icon name="map-pin" className="w-7 h-7 text-teal-300" />
      </div>
      <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">{headline}</h2>
      <p className="text-gray-400 text-sm sm:text-base max-w-md mx-auto mb-6 leading-relaxed">
        We're live in <span className="text-white font-semibold">{city}</span> but there are no
        verified listings here yet. Be the first owner to list — zero brokerage, and your number
        stays private.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => navigate('/list-property')}
          className="btn btn-primary"
        >
          <Icon name="plus" className="w-4 h-4" /> List your property
        </button>
        <button
          onClick={() => setCity('Pune')}
          className="btn btn-secondary"
        >
          <Icon name="arrow-right" className="w-4 h-4" /> Explore Pune instead
        </button>
      </div>
    </div>
  );
}
