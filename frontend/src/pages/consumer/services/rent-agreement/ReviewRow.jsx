export default function ReviewRow({ k, v }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-white/5">
      <span className="text-gray-500 text-sm">{k}</span>
      <span className="text-white text-sm font-medium text-right">{v || '—'}</span>
    </div>
  );
}
