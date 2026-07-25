import { useState } from 'react';

export default function useListingMedia({ errors, setErrors }) {
  const [photos, setPhotos] = useState([]);
  const [video, setVideo] = useState(null);
  const [videoName, setVideoName] = useState('');
  const [documents, setDocuments] = useState({});

  /* ---------- uploads ---------- */
  const handlePhotoUpload = (e) => {
    Array.from(e.target.files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (evt) => setPhotos((prev) => [...prev, { url: evt.target.result, category: 'Other' }]);
      reader.readAsDataURL(file);
    });
    if (e.target.files.length && errors.photos) setErrors((prev) => { const n = { ...prev }; delete n.photos; return n; });
    e.target.value = '';
  };
  const removePhoto = (i) => setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  const setPhotoCategory = (i, cat) => setPhotos((prev) => prev.map((p, idx) => idx === i ? { ...p, category: cat } : p));
  const handleVideoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => { setVideo(evt.target.result); setVideoName(file.name); };
    reader.readAsDataURL(file);
  };
  const handleDocUpload = (key, e) => {
    const file = e.target.files[0];
    if (!file) return;
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
