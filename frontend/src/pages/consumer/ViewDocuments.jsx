import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import { classNames } from '../../lib/format.js';
import { loadSharedDocuments } from '../../lib/data/viewDocuments.js';

function drawWatermark(ctx, w, h, label) {
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#0d9488';
  ctx.font = `bold ${Math.round(w / 22)}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = Math.max(24, Math.round(h / 5)); // guard: tiny images round h/5 to 0 → infinite loop
  for (let y = 0; y < h + w; y += step) {
    ctx.save();
    ctx.translate(w / 2, y - w / 2);
    ctx.rotate(-Math.PI / 7);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function DownloadFallback({ doc }) {
  const { t } = useTranslation();
  return (
    <div className="text-gray-500 text-sm py-4 flex items-start gap-3">
      <Icon name="alert-circle" className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" />
      <p>
        <Trans i18nKey="viewDocs.cantPreview" values={{ name: doc.name || t('viewDocs.thisFile') }} components={{ 1: <span className="text-gray-300" /> }} />
      </p>
    </div>
  );
}

const isPdfDoc = (doc) => /pdf/i.test(doc.mime || '') || /\.pdf$/i.test(doc.name || '');
const isImageDoc = (doc) => /image/i.test(doc.mime || '');
const docTypeIcon = (doc) => (isImageDoc(doc) ? 'image' : isPdfDoc(doc) ? 'file-text' : 'file-lock-2');

// Decode a base64 data URL to bytes for pdf.js (it wants a typed array, not a URL).
function dataUrlToBytes(dataUrl) {
  try {
    const base64 = String(dataUrl).split(',')[1] || '';
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// Shared zoom toolbar for both the image and PDF canvas viewers.
function ZoomBar({ zoom, setZoom }) {
  const { t } = useTranslation();
  const btn = 'inline-flex items-center justify-center h-11 w-11 rounded-lg bg-white/5 border border-white/10 text-gray-200 hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none';
  return (
    <div className="flex items-center justify-end gap-1.5 mb-3">
      <button type="button" aria-label={t('viewDocs.zoomOut')} onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))} disabled={zoom <= 1} className={btn}>
        <Icon name="minus" className="w-4 h-4" />
      </button>
      <span className="text-xs text-gray-400 w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label={t('viewDocs.zoomIn')} onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} disabled={zoom >= 3} className={btn}>
        <Icon name="plus" className="w-4 h-4" />
      </button>
      <button type="button" aria-label={t('viewDocs.resetZoom')} onClick={() => setZoom(1)} disabled={zoom === 1} className="inline-flex items-center justify-center h-11 px-3 rounded-lg bg-white/5 border border-white/10 text-gray-200 text-xs font-medium hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none">
        {t('viewDocs.reset')}
      </button>
    </div>
  );
}

// Images: draw onto a canvas with a tiled watermark. Guarded against StrictMode
// double-run and rapid doc switches so it never draws twice or leaks.
function ImageViewer({ doc }) {
  const { t } = useTranslation();
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    let cancelled = false;
    const canvas = canvasRef.current;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const maxWidth = wrapRef.current?.clientWidth || 760;
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      drawWatermark(ctx, canvas.width, canvas.height, t('viewDocs.watermark'));
    };
    img.onerror = () => { if (!cancelled) setError(true); };
    img.src = doc.dataUrl;
    return () => { cancelled = true; };
  }, [doc, t]);

  if (error) return <DownloadFallback doc={doc} />;

  return (
    <div>
      <ZoomBar zoom={zoom} setZoom={setZoom} />
      <div ref={wrapRef} className="overflow-auto rounded-lg" style={{ maxHeight: '70vh' }}>
        <canvas ref={canvasRef} className="doc-canvas block rounded-lg shadow-xl" style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }} />
      </div>
    </div>
  );
}

// PDFs: render every page with pdf.js to a watermarked canvas. pdf.js is
// dynamically imported so it only loads when a PDF is actually shown (this route
// is already lazy). Canvas rendering keeps the file strictly view-only — there's
// no native download/print UI and the watermark is baked into each page.
function PdfViewer({ doc }) {
  const { t } = useTranslation();
  const scrollRef = useRef(null);
  const pagesRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'

  useEffect(() => {
    let cancelled = false;
    const host = pagesRef.current;
    (async () => {
      try {
        setStatus('loading');
        const pdfjs = await import('pdfjs-dist');
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        }
        const bytes = dataUrlToBytes(doc.dataUrl);
        if (!bytes) throw new Error('Unreadable PDF data');
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        if (host) host.replaceChildren();
        const containerW = scrollRef.current?.clientWidth || 760;
        const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap so mobile canvases stay light
        for (let n = 1; n <= pdf.numPages; n += 1) {
          const page = await pdf.getPage(n); // eslint-disable-line no-await-in-loop
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (containerW / base.width) * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = 'doc-canvas block rounded-lg shadow-xl';
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          if (n < pdf.numPages) canvas.style.marginBottom = '12px';
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise; // eslint-disable-line no-await-in-loop
          if (cancelled) return;
          drawWatermark(ctx, canvas.width, canvas.height, t('viewDocs.watermark'));
          if (host && !cancelled) host.appendChild(canvas);
        }
        if (!cancelled) setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; if (host) host.replaceChildren(); };
  }, [doc, t]);

  if (status === 'error') return <DownloadFallback doc={doc} />;

  return (
    <div>
      <ZoomBar zoom={zoom} setZoom={setZoom} />
      <div ref={scrollRef} className="relative overflow-auto rounded-lg" style={{ maxHeight: '70vh' }}>
        {status === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-20 text-gray-400 text-sm">
            <Icon name="loader-2" className="w-5 h-5 animate-spin text-teal-400" /> {t('viewDocs.rendering')}
          </div>
        )}
        <div ref={pagesRef} style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }} />
      </div>
    </div>
  );
}

function DocumentViewer({ doc }) {
  if (!doc.dataUrl) return <DownloadFallback doc={doc} />;
  if (isImageDoc(doc)) return <ImageViewer doc={doc} />;
  if (isPdfDoc(doc)) return <PdfViewer doc={doc} />;
  return <DownloadFallback doc={doc} />;
}

function DocumentCard({ doc }) {
  const { t } = useTranslation();
  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center flex-shrink-0">
          <Icon name={docTypeIcon(doc)} className="w-5 h-5 text-teal-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-white font-semibold truncate">{doc.name}</p>
          <p className="text-gray-500 text-xs">
            <span className="text-teal-300">{doc.category || t('viewDocs.document')}</span>
          </p>
        </div>
      </div>
      <DocumentViewer doc={doc} />
    </div>
  );
}

// Horizontally-scrollable strip that lets the buyer jump to any shared paper.
// Only the selected document is rendered below, so a multi-doc share no longer
// stacks every viewer at full height (big mobile scroll + memory win).
function DocSwitcher({ docs, active, onSelect }) {
  const { t } = useTranslation();
  return (
    <HScroll role="tablist" aria-label={t('viewDocs.sharedDocsAria')} fadeColor="#0f0d1a" className="flex gap-2 pb-1" wrapClassName="mb-4">
      {docs.map((d, i) => {
        const selected = i === active;
        return (
          <button
            key={d.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(i)}
            className={classNames(
              'group flex items-center gap-2.5 shrink-0 max-w-[15rem] rounded-xl border px-3 py-2 text-left transition',
              selected ? 'bg-teal-400/15 border-teal-400/40' : 'bg-white/5 border-white/10 hover:bg-white/10',
            )}
          >
            <span className={classNames('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', selected ? 'bg-teal-400/20' : 'bg-white/5')}>
              <Icon name={docTypeIcon(d)} className={classNames('w-4 h-4', selected ? 'text-teal-300' : 'text-gray-400')} />
            </span>
            <span className="min-w-0">
              <span className={classNames('block text-sm font-medium truncate', selected ? 'text-white' : 'text-gray-300')}>{d.name}</span>
              <span className="block text-[11px] text-teal-300/80 truncate">{d.category || t('viewDocs.document')}</span>
            </span>
          </button>
        );
      })}
    </HScroll>
  );
}

function DocNav({ active, total, onSelect }) {
  const { t } = useTranslation();
  const btn = 'inline-flex items-center gap-1.5 h-11 px-4 rounded-lg bg-white/5 border border-white/10 text-gray-200 text-sm font-medium hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none';
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <button type="button" disabled={active === 0} onClick={() => onSelect(active - 1)} className={btn}>
        <Icon name="chevron-left" className="w-4 h-4" /> {t('viewDocs.prev')}
      </button>
      <span className="text-xs text-gray-500 tabular-nums">{t('viewDocs.docXofY', { index: active + 1, total })}</span>
      <button type="button" disabled={active === total - 1} onClick={() => onSelect(active + 1)} className={btn}>
        {t('viewDocs.next')} <Icon name="chevron-right" className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function ViewDocuments() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const owner = params.get('o') || 'anon';
  const reqId = params.get('r');
  const propId = params.get('p');
  const docId = params.get('d');

  const { shared, sub, errorState } = loadSharedDocuments(owner, reqId, propId, docId);
  const [active, setActive] = useState(0);

  // View-only protections (match original: block right-click, drag, Ctrl/Cmd+S/P).
  useEffect(() => {
    const noCtx = (e) => e.preventDefault();
    const noDrag = (e) => e.preventDefault();
    const noKeys = (e) => {
      const k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'p')) e.preventDefault();
    };
    document.addEventListener('contextmenu', noCtx);
    document.addEventListener('dragstart', noDrag);
    document.addEventListener('keydown', noKeys);
    return () => {
      document.removeEventListener('contextmenu', noCtx);
      document.removeEventListener('dragstart', noDrag);
      document.removeEventListener('keydown', noKeys);
    };
  }, []);

  const showEmpty = errorState || shared.length === 0;
  const emptyTitle = errorState ? t(errorState.titleKey) : t('viewDocs.emptyTitle');
  const emptyText = errorState ? t(errorState.textKey) : t('viewDocs.emptyText');
  const subtitle = errorState ? t(errorState.subKey) : (sub ? t(sub.key, sub.args) : t('viewDocs.loading'));

  const total = shared.length;
  const idx = Math.min(active, Math.max(0, total - 1)); // clamp if the share shrinks
  const activeDoc = shared[idx];

  return (
    <div className="vd-page min-h-[100dvh]" style={{ background: '#0f0d1a' }}>
      {/* Top bar */}
      <nav className="glass-nav sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#0d9488,#14b8a6)' }}
            >
              <Icon name="home" className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-extrabold tracking-tight">
              Pune<span className="gradient-text">Nest</span>
            </span>
          </Link>
          <span className="flex items-center gap-2">
            <Link
              to="/dashboard"
              aria-label={t('viewDocs.closeAria')}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-full bg-white/5 border border-white/10 text-gray-200 text-xs font-medium hover:bg-white/10"
            >
              <Icon name="x" className="w-4 h-4" /> <span className="hidden sm:inline">{t('viewDocs.close')}</span>
            </Link>
            <span className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-400/25 whitespace-nowrap">
              <Icon name="lock" className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden sm:inline">{t('viewDocs.viewOnlyLong')}</span>
              <span className="sm:hidden">{t('viewDocs.viewOnlyShort')}</span>
            </span>
          </span>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Icon name="folder-lock" className="w-6 h-6 text-teal-400" /> {t('viewDocs.title')}
          </h1>
          <p className="text-gray-400 text-sm mt-1">{subtitle}</p>
        </div>

        <div
          className="glass-card rounded-2xl px-5 py-3.5 mb-6 flex items-start gap-3 border border-amber-500/20"
          style={{ background: 'rgba(245,158,11,.07)' }}
        >
          <Icon name="shield-alert" className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-100/90">
            <Trans i18nKey="viewDocs.notice" components={{ 1: <span className="font-semibold" /> }} />
          </p>
        </div>

        {showEmpty ? (
          <div className="glass-card rounded-2xl p-10 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
              <Icon name="file-lock-2" className="w-8 h-8 text-gray-500" />
            </div>
            <p className="text-white font-semibold">{emptyTitle}</p>
            <p className="text-gray-500 text-sm mt-1">{emptyText}</p>
            <Link
              to="/dashboard"
              className="btn btn-primary mt-5"
            >
              <Icon name="arrow-left" className="w-4 h-4" /> {t('viewDocs.backToDashboard')}
            </Link>
          </div>
        ) : (
          <div>
            {total > 1 && <DocSwitcher docs={shared} active={idx} onSelect={setActive} />}
            <DocumentCard key={activeDoc.id} doc={activeDoc} />
            {total > 1 && <DocNav active={idx} total={total} onSelect={setActive} />}
          </div>
        )}
      </div>
    </div>
  );
}
