import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Select from '../../../components/ui/Select.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import {
  DOC_CATEGORIES, getDocsForProp, addDocument, deleteDocument, formatSize, docIcon,
} from '../../../lib/data/documents.js';
import { DOC_CAT_KEYS } from './constants.js';

const CATEGORY_NAMES = Object.keys(DOC_CATEGORIES);
const SIZE_CAP = 3 * 1024 * 1024; // 3 MB — dataURL kept only under the cap.

/* A recognisable icon per document category so the picker doubles as a filing
   cabinet the owner can scan at a glance. */
const CAT_ICON = {
  'Title & Ownership': 'scroll-text',
  Society: 'building-2',
  'Approvals & Plans': 'ruler',
  'Purchase & Payments': 'receipt-indian-rupee',
  'Tax & Utilities': 'landmark',
};
const catIcon = (c) => CAT_ICON[c] || 'file-text';

/* Open a stored document in a new tab. dataURLs are converted to a Blob URL
   because Chrome blocks top-frame navigation straight to a data: URL. */
function openDoc(d, toast, t) {
  if (!d.dataUrl) return;
  try {
    const [meta, b64] = d.dataUrl.split(',');
    const mime = (/data:(.*?);base64/.exec(meta) || [])[1] || d.mime || 'application/octet-stream';
    // A blob: URL typed text/html executes script in this origin when opened as a
    // top-level document, so the stored MIME is allowlisted before the Blob is built.
    if (!/^(image\/[a-z0-9.+-]+|application\/pdf)$/i.test(mime)) { toast(t('ownerHub.cantOpen'), 'error'); return; }
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) toast(t('ownerHub.allowPopups'), 'info');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    toast(t('ownerHub.cantOpen'), 'error');
  }
}

/* Property Passport — document vault. Reuses the existing per-property document
   store (documents.js). Files over the cap keep only their metadata (the same
   graceful fallback the listing flow uses), so the vault never blows quota. */
export default function DocVault({ mobile, propId, onChange }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [docs, setDocs] = useState(() => getDocsForProp(mobile, propId));
  const [category, setCategory] = useState(CATEGORY_NAMES[0]);
  const inputRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const sync = () => { const next = getDocsForProp(mobile, propId); setDocs(next); onChange?.(next.length); };

  const onPick = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const finish = (dataUrl) => {
      if (!mounted.current) return;
      addDocument(mobile, propId, { category, name: file.name, size: file.size, mime: file.type, dataUrl });
      sync();
      toast(t('ownerHub.docAdded'), 'success');
    };
    if (file.size > SIZE_CAP) { finish(null); }
    else {
      const reader = new FileReader();
      reader.onload = () => finish(reader.result);
      reader.onerror = () => finish(null);
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const remove = (id) => { deleteDocument(mobile, propId, id); sync(); toast(t('ownerHub.docRemoved'), 'info'); };

  // Count per category powers both the picker badges and the coverage line.
  const countByCat = useMemo(() => {
    const m = {};
    for (const d of docs) m[d.category] = (m[d.category] || 0) + 1;
    return m;
  }, [docs]);

  const options = useMemo(() => CATEGORY_NAMES.map((c) => ({
    value: c,
    label: t(DOC_CAT_KEYS[c] || c),
    icon: catIcon(c),
    badge: countByCat[c] || undefined,
  })), [countByCat, t]);

  // Group the list by category, in canonical order; stray/legacy categories fall under "Other".
  const groups = useMemo(() => {
    const known = new Set(CATEGORY_NAMES);
    const g = CATEGORY_NAMES
      .map((c) => ({ cat: c, items: docs.filter((d) => d.category === c) }))
      .filter((x) => x.items.length);
    const others = docs.filter((d) => !known.has(d.category));
    if (others.length) g.push({ cat: 'Other', items: others });
    return g;
  }, [docs]);

  const covered = CATEGORY_NAMES.filter((c) => countByCat[c]).length;

  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="folder-lock" className="w-5 h-5 text-brand-teal-2" />
        <h2 className="text-lg font-bold text-white">{t('ownerHub.docPassport')}</h2>
      </div>
      <p className="text-gray-400 text-sm mb-5">{t('ownerHub.docPassportSub')}</p>

      <div className="flex flex-col sm:flex-row gap-2.5 mb-5">
        <Select
          value={category}
          onChange={setCategory}
          options={options}
          ariaLabel={t('ownerHub.docCategory')}
          prefix={t('ownerHub.category')}
          className="flex-1"
        />
        <input ref={inputRef} type="file" accept="application/pdf,image/*" onChange={onPick} className="hidden" />
        <button onClick={() => inputRef.current?.click()} className="btn-teal px-5 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2">
          <Icon name="upload" className="w-4 h-4" /> {t('ownerHub.upload')}
        </button>
      </div>

      {docs.length ? (
        <>
          <div className="flex items-center gap-2 mb-3 text-xs text-gray-400">
            <Icon name="shield-check" className="w-3.5 h-3.5 text-brand-teal-3" />
            <span><Trans i18nKey="ownerHub.docCoverage" count={docs.length} values={{ count: docs.length, covered, total: CATEGORY_NAMES.length }} components={{ 1: <span className="text-gray-200 font-semibold" />, 3: <span className="text-gray-200 font-semibold" /> }} /></span>
          </div>
          <div className="space-y-4">
            {groups.map((grp) => (
              <div key={grp.cat}>
                <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
                  <Icon name={catIcon(grp.cat)} className="w-3.5 h-3.5 text-brand-teal-2" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t(DOC_CAT_KEYS[grp.cat] || grp.cat)}</span>
                  <span className="text-[11px] text-gray-600">· {grp.items.length}</span>
                </div>
                <ul className="space-y-2">
                  {grp.items.map((d) => (
                    <li key={d.id} className="rd-cell flex items-center gap-3">
                      <span className="w-9 h-9 rounded-lg bg-brand-teal/10 flex items-center justify-center flex-shrink-0"><Icon name={docIcon(d.mime)} className="w-4 h-4 text-brand-teal-3" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-medium truncate">{d.name}</p>
                        <p className="text-gray-500 text-[11px]">{d.size ? formatSize(d.size) : ''}{d.dataUrl ? '' : (d.size ? ` · ${t('ownerHub.metadataOnly')}` : t('ownerHub.metadataOnly'))}</p>
                      </div>
                      {d.dataUrl ? (
                        <button onClick={() => openDoc(d, toast, t)} aria-label={t('ownerHub.viewDoc', { name: d.name })} className="p-2 rounded-lg text-gray-500 hover:text-brand-teal-3 hover:bg-brand-teal/10 transition-all">
                          <Icon name="eye" className="w-4 h-4" />
                        </button>
                      ) : null}
                      <button onClick={() => remove(d.id)} aria-label={t('ownerHub.deleteDoc', { name: d.name })} className="p-2 rounded-lg text-gray-500 hover:text-rose-300 hover:bg-rose-500/10 transition-all">
                        <Icon name="trash-2" className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-gray-500 text-sm text-center py-6">{t('ownerHub.noDocs')}</p>
      )}
    </div>
  );
}
