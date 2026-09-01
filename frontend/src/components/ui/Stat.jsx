export default function Stat({ label, value, icon: Icon, hint }) {
  return (
    <div className="dz-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-gray-400">{label}</div>
          <div className="mt-1 text-2xl font-extrabold">{value}</div>
          {hint ? <div className="mt-1 text-xs text-gray-500">{hint}</div> : null}
        </div>
        {Icon ? (
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-teal/15 text-brand-teal">
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
      </div>
    </div>
  );
}
