// Wrappers: media-wrappers - extracted from modules/wrappers/media-wrappers.js
// Re-exports from core/utils for media operations

export function thumbImg(url, w = 40, h = 56) {
  if (!url) return '';
  const encodedUrl = encodeURIComponent(String(url));
  return `https://images.unsplash.com/photo-${encodedUrl}?w=${w}&h=${h}&fit=crop`;
}
