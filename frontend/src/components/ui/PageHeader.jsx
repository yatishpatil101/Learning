export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-4 sm:mb-6 flex flex-col gap-2 sm:gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-gray-400">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
