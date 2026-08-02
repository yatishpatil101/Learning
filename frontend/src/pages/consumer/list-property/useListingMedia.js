import { useState } from 'react';

/* The `accept` attribute on a file input is a picker HINT only — drag-drop and a
   scripted DataTransfer both bypass it. Without these guards a several-hundred-MB
   video gets base64'd into memory and localStorage (tab freeze + QuotaExceededError),
   and arbitrary MIME data URLs enter the store to be re-opened later. Mirrors the
   caps already enforced in EvidenceUpload and the flatmates agreement upload. */
const PHOTO_MIME_RE = /^image\/(png|jpe?g|webp|heic|heif|avif)$/i;
const VIDEO_MIME_RE = /^video\/(mp4|quicktime|webm)$/i;
const DOC_MIME_RE = /^(image\/(png|jpe?g|webp|heic|heif)|application\/pdf)$/i;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_DOC_BYTES = 3 * 1024 * 1024;

export default function useListingMedia({ errors, setErrors }) {
  const [photos, setPhotos] = useState([]);
  const [video, setVideo] = useState(null);
  const [videoName, setVideoName] = useState('');
  const [documents, setDocuments] = useState({});

  const setError = (key, msg) => setErrors((prev) => ({ ...prev, [key]: msg }));
  const clearError = (key) => setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  const accepts = (file, re, max) => !!file && re.test(file.type || '') && (file.size || 0) <= max;

  /* ---------- uploads ---------- */
  const handlePhotoUpload = (e) => {
    const picked = Array.from(e.target.files);
    const ok = picked.filter((f) => accepts(f, PHOTO_MIME_RE, MAX_PHOTO_BYTES));
    ok.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (evt) => setPhotos((prev) => [...prev, { url: evt.target.result, category: 'Other' }]);
      reader.readAsDataURL(file);
    });
    if (ok.length < picked.length) setError('photos', 'Some files were skipped — photos must be JPG/PNG/WebP under 5 MB.');
    else if (ok.length && errors.photos) clearError('photos');
    e.target.value = '';
  };
  const removePhoto = (i) => setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  const setPhotoCategory = (i, cat) => setPhotos((prev) => prev.map((p, idx) => idx === i ? { ...p, category: cat } : p));
  const handleVideoUpload = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!accepts(file, VIDEO_MIME_RE, MAX_VIDEO_BYTES)) { setError('video', 'Video must be MP4/WebM/MOV under 25 MB.'); return; }
    clearError('video');
    const reader = new FileReader();
    reader.onload = (evt) => { setVideo(evt.target.result); setVideoName(file.name); };
    reader.readAsDataURL(file);
  };
  const handleDocUpload = (key, e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!accepts(file, DOC_MIME_RE, MAX_DOC_BYTES)) { setError(key, 'Document must be a PDF or image under 3 MB.'); return; }
    clearError(key);
    const reader = new FileReader();
    reader.onload = (evt) => setDocuments((prev) => ({ ...prev, [key]: { name: file.name, data: evt.target.result, size: file.size, mime: file.type || '' } }));
    reader.readAsDataURL(file);
  };

  return {
    photos, setPhotos,
    video, setVideo,
    videoName, setVideoName,
    documents, setDocuments,
    handlePhotoUpload, removePhoto, setPhotoCategory, handleVideoUpload, handleDocUpload,
  };
}
