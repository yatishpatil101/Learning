/** A flat, divider-separated block of the badge case: a heading, an optional count, the content. */
export default function Section({ title, meta, children }) {
  return (
    <div className="py-4">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h4>
        {meta ? <span className="ml-auto text-xs text-gray-500">{meta}</span> : null}
      </div>
      {children}
    </div>
  );
}
