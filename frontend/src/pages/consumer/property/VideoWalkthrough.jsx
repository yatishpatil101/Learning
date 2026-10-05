import { useState } from 'react';
import Icon from '../../../components/Icon.jsx';

export default function VideoWalkthrough({ id, title, label }) {
  const [play, setPlay] = useState(false);
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(id || ''))) return null;
  const safeTitle = label || 'Video walkthrough';
  return (
    <section className="fade-in mb-6 sm:mb-10">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] aspect-video">
        {play ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
            title={`${safeTitle}: ${title}`}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        ) : (
          <button type="button" onClick={() => setPlay(true)} className="group h-full w-full">
            <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-95" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-black/70 text-white ring-1 ring-white/20">
                <Icon name="play" className="h-7 w-7 translate-x-0.5" />
              </span>
            </span>
            <span className="absolute left-4 top-4 rounded-full bg-black/70 px-3 py-1.5 text-sm font-semibold text-white">{safeTitle}</span>
          </button>
        )}
      </div>
    </section>
  );
}
