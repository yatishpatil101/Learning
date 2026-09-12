import { Link } from 'react-router';
import { Compass } from 'lucide-react';

/* Catch-all 404 for unknown routes. Gives a clear "not found" message and
   obvious paths back into the app (home + browse listings). */
export default function Stub({ title = 'Page not found' }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-teal/15 text-brand-teal">
        <Compass className="h-7 w-7" />
      </span>
      <p className="mt-5 text-sm font-bold tracking-widest text-brand-teal">404</p>
      <h1 className="mt-1 text-2xl font-extrabold">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-gray-400">
        The page you're looking for doesn't exist or may have moved. Let's get you back on track.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link to="/" className="dz-btn dz-btn-primary">Back to home</Link>
        <Link to="/listings" className="dz-btn dz-btn-ghost">Browse properties</Link>
      </div>
    </div>
  );
}
