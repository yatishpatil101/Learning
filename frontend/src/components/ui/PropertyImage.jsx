/* A listing photo, or nothing at all.
 *
 * `<img src="">` is not an image-less image. The browser resolves the empty
 * string against the document URL and re-downloads the entire HTML page as if
 * it were a photo — one wasted full-page request per photoless card, thirty of
 * them on a search results screen — and React warns about it in the console.
 * A photoless listing is ordinary (an owner can publish before the photos are
 * uploaded), so every surface that piped `p.image` straight into `src` was
 * paying that cost as a matter of routine.
 *
 * The empty state is a bare div rather than a placeholder image file, because a
 * fallback file costs exactly the round trip this component exists to remove.
 * It inherits the image's own classes so the box keeps its size and corners,
 * and carries `img-empty` for the handful of surfaces that size their photo
 * from CSS through an `img` descendant selector.
 */
export default function PropertyImage({ src, alt = '', className = '', style, ...rest }) {
  if (!src) {
    return <div className={`${className} img-empty bg-white/5`.trim()} style={style} aria-hidden="true" />;
  }
  return <img src={src} alt={alt} className={className} style={style} {...rest} />;
}
