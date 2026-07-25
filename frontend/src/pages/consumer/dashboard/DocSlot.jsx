import Icon from '../../../components/Icon.jsx';
import { formatSize } from '../../../lib/data/documents.js';

export default function DocSlot({ category, uploadedDocs, onUpload, onRemove, onView }) {
  const doc = uploadedDocs.find((d) => d.category?.toLowerCase().includes(category.toLowerCase().slice(0, 8)));
  return (
    <div className={'flex items-center gap-3 p-3 rounded-xl border transition ' + (doc ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-dashed border-white/15 bg-white/[0.02]')}>
      <div className={'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ' + (doc ? 'bg-emerald-500/15' : 'bg-white/5')}>
        <Icon name={doc ? 'check-circle' : 'file-plus'} className={'w-4 h-4 ' + (doc ? 'text-emerald-400' : 'text-gray-500')} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={'text-sm font-medium ' + (doc ? 'text-white' : 'text-gray-400')}>{category}</p>
        {doc && <p className="text-gray-500 text-[11px] truncate">{doc.name} · {formatSize(doc.size)}</p>}
      </div>
      {doc ? (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={() => onView(doc)} className="text-[10px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-300 font-semibold">View</button>
          <button onClick={() => onRemove(doc.id)} className="text-gray-500 hover:text-rose-400 p-1"><Icon name="trash-2" className="w-3.5 h-3.5" /></button>
        </div>
      ) : (
        <button onClick={() => onUpload(category)} className="text-[10px] px-3 py-1.5 rounded-lg border border-dashed border-teal-400/40 text-teal-400 font-semibold hover:bg-teal-400/10 hover:border-teal-400/60 flex items-center gap-1.5 flex-shrink-0">
          <Icon name="upload" className="w-3 h-3" /> Upload
        </button>
      )}
    </div>
  );
}
