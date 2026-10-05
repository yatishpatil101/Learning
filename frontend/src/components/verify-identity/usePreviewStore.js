import { useEffect, useRef, useState } from 'react';
import { capturePreviewUrl, releasePreviewUrl } from '../../lib/identity-verification/capture.js';

const EMPTY_CAPTURES = { front: null, back: null, selfie: null };

export default function usePreviewStore() {
  const capturesRef = useRef(EMPTY_CAPTURES);
  const [captures, setCaptures] = useState(EMPTY_CAPTURES);

  useEffect(() => () => {
    Object.values(capturesRef.current).forEach((item) => releasePreviewUrl(item?.url));
  }, []);

  const replaceCaptures = (next) => {
    capturesRef.current = next;
    setCaptures(next);
  };

  const setCapture = (key, file) => {
    const previousUrl = capturesRef.current[key]?.url;
    replaceCaptures({ ...capturesRef.current, [key]: { file, url: capturePreviewUrl(file) } });
    releasePreviewUrl(previousUrl);
  };

  const resetCapture = (key) => {
    const previousUrl = capturesRef.current[key]?.url;
    replaceCaptures({ ...capturesRef.current, [key]: null });
    releasePreviewUrl(previousUrl);
  };

  const clearCaptures = () => {
    const previous = capturesRef.current;
    replaceCaptures(EMPTY_CAPTURES);
    Object.values(previous).forEach((item) => releasePreviewUrl(item?.url));
  };

  return { captures, setCapture, resetCapture, clearCaptures };
}
