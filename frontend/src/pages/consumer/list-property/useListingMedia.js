import { useEffect, useRef, useState } from 'react';
import { uploadPhoto } from '../../../services/photoService.js';
import { prepareUpload } from '../../../lib/uploads/prepareUpload.js';
import { MAX_PHOTOS } from '../../../lib/uploads/policy.js';

export default function useListingMedia({ setErrors }) {
  const [photos, setPhotos] = useState([]);
  const [video, setVideo] = useState(null);
  const [videoName, setVideoName] = useState('');
  const [documents, setDocuments] = useState({});
  const [mediaStatus, setMediaStatus] = useState('');
  const operation = useRef(null);
  useEffect(() => () => { operation.current?.abort(); }, []);

  const setError = (key, msg) => setErrors((prev) => ({ ...prev, [key]: msg }));
  const clearError = (key) => setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  const start = () => {
    if (operation.current) return null;
    const controller = new AbortController();
    operation.current = controller;
    return controller;
  };
  const finish = (controller) => {
    if (!controller.signal.aborted) { operation.current = null; setMediaStatus(''); }
  };

  const handlePhotoUpload = async (e) => {
    const input = e.target;
    const picked = Array.from(input.files || []);
    input.value = '';
    if (!picked.length) return;
    const controller = start();
    if (!controller) return;
    const available = Math.max(0, MAX_PHOTOS - photos.length);
    const batch = picked.slice(0, available);
    const failures = picked.length > available ? ['Only 10 photos are allowed. Extra selections were skipped.'] : [];
    clearError('photos');
    try {
      for (const [index, file] of batch.entries()) {
        setMediaStatus(`Preparing and uploading photo ${index + 1} of ${batch.length}…`);
        try {
          const { url } = await uploadPhoto(file, { signal: controller.signal });
          controller.signal.throwIfAborted();
          setPhotos((prev) => [...prev, { url, category: 'Other' }]);
        } catch (error) {
          if (controller.signal.aborted) return;
          failures.push(`${file.name}: ${error.message || 'Upload failed. Please try again.'}`);
        }
      }
      if (failures.length) setError('photos', failures.join(' '));
    } finally { finish(controller); }
  };
  const removePhoto = (i) => setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  const setPhotoCategory = (i, cat) => setPhotos((prev) => prev.map((p, idx) => idx === i ? { ...p, category: cat } : p));
  const handleDocUpload = async (key, e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const controller = start();
    if (!controller) return;
    clearError(key);
    setMediaStatus(`Preparing ${file.name}…`);
    try {
      const prepared = await prepareUpload(file, {
        document: true, originalPdf: key === 'Electricity Bill', signal: controller.signal,
      });
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the document. Please try again.'));
        reader.readAsDataURL(prepared);
      });
      controller.signal.throwIfAborted();
      setDocuments((prev) => ({ ...prev, [key]: { name: prepared.name, data, size: prepared.size, mime: prepared.type } }));
    } catch (error) {
      if (!controller.signal.aborted) setError(key, error.message || 'Could not prepare the document.');
    } finally { finish(controller); }
  };

  return {
    photos, setPhotos,
    video, setVideo,
    videoName, setVideoName,
    documents, setDocuments,
    mediaStatus, isMediaBusy: !!mediaStatus, isMediaProcessing: () => !!operation.current,
    handlePhotoUpload, removePhoto, setPhotoCategory, handleDocUpload,
  };
}
