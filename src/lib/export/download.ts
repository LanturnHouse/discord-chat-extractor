/** Chrome keeps reading the blob after the click, so the object URL must outlive it for a while. */
const REVOKE_DELAY_MS = 60_000;

/**
 * Saves `blob` through the browser's download mechanism (object URL + temporary `<a download>`).
 * Throws a descriptive error outside a DOM environment (service worker, plain Node).
 */
export function saveBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('saveBlob needs a browser page (document and URL.createObjectURL are not available here).');
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  const parent = document.body ?? document.documentElement;
  parent.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }
}
