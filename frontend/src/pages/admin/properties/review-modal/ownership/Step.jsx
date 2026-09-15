/* The ordinals are load-bearing: recording a document and granting the badge are separate
   decisions, and a number is the cheapest way to say so at a glance. */
export default function Step({ n, title, meta, children }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
      <div className="mb-3 flex items-center gap-2.5">
        <span aria-hidden="true" className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full border border-white/15 bg-white/5 text-[11px] font-bold text-gray-300">{n}</span>
        <h4 className="text-sm font-bold text-gray-100">{title}</h4>
        {meta ? <span className="ml-auto flex-shrink-0 text-xs text-gray-400">{meta}</span> : null}
      </div>
      {children}
    </div>
  );
}
