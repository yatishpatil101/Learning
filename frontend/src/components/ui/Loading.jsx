import { Loader2 } from 'lucide-react';

export default function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
      <Loader2 className="h-5 w-5 animate-spin text-brand-teal" /> {label}
    </div>
  );
}
