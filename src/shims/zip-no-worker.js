// Shim for "@zip.js/zip.js/lib/zip-no-worker.js" (removed in zip.js 2.8+).
// Re-exports the full API with web workers disabled, matching the old entry.
export * from '@zip.js/zip.js';
import { configure } from '@zip.js/zip.js';
configure({ useWebWorkers: false });
