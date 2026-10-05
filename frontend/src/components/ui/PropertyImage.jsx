/* A listing photo, or nothing at all. `<img src="">` is not an image-less image. The browser resolves the empty
   string against the document URL and re-downloads the entire HTML page as if it were a photo. */
import { useState } from 'react';
import NoPhotoPlaceholder from './NoPhotoPlaceholder.jsx';
import { cardSrcSet } from '../../lib/imgSrcSet.js';

// Callers wider than a thumbnail pass their own `sizes`; the full-size gallery uses a plain <img>.
export default function PropertyImage({ src, srcSet = cardSrcSet(src), sizes = '240px', alt = '', className = '', style, ...rest }) {
  // A photo uploaded before card copies existed has none; drop the srcset and show the original.
  const [failedSrc, setFailedSrc] = useState(null);
  if (!src) {
    return <NoPhotoPlaceholder className={`${className} img-empty`.trim()} style={style} />;
  }
  const candidates = failedSrc === src ? undefined : srcSet;
  return (
    <img
      src={src}
      srcSet={candidates}
      sizes={candidates ? sizes : undefined}
      alt={alt}
      className={className}
      style={style}
      onError={candidates ? () => setFailedSrc(src) : undefined}
      {...rest}
    />
  );
}
