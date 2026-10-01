/**
 * globals.d.ts — the two globals the consent gate owns.
 *
 * `window.gtag` does not exist until a visitor says yes, so every use of it is
 * optional-chained and the page has no way to send an event before it is
 * answered. `window.atlasTrack` is the page's own shim onto it, and is defined
 * by the gate for the same reason: an event helper that exists without consent
 * would be a way to send one without consent.
 */

interface Window {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  atlasTrack?: (name: string, params?: Record<string, unknown>) => void;
}
