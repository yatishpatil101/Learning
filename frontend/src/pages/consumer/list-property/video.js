const ID = '[A-Za-z0-9_-]{11}';
const WATCH = new RegExp(`^https?://(?:www\\.)?youtube\\.com/watch\\?(?:[^#]*&)?v=(${ID})(?:[&#].*)?$`, 'i');
const SHORT = new RegExp(`^https?://youtu\\.be/(${ID})(?:[?#].*)?$`, 'i');
const SHORTS = new RegExp(`^https?://(?:www\\.)?youtube\\.com/shorts/(${ID})(?:[?#].*)?$`, 'i');
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function normalizeYouTubeId(value) {
  const text = String(value || '').trim();
  if (!text) return { ok: true, id: '' };
  if (YOUTUBE_ID_RE.test(text)) return { ok: true, id: text };
  const match = WATCH.exec(text) || SHORT.exec(text) || SHORTS.exec(text);
  return match ? { ok: true, id: match[1] } : { ok: false, id: '' };
}
