// Values come from EXPO_PUBLIC_* env vars (see .env.example), inlined at build time.

/** Nest backend, e.g. https://api.nudgebuddy.app/v1 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

/**
 * Deployed Next.js web app. The mobile app reuses its /api/tts and
 * /api/stt-token routes so the ElevenLabs key never ships in the app.
 */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? "").replace(/\/$/, "");

/** Google OAuth web client id — the backend verifies ID tokens against it */
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";

/** Websocket URL for the backend gateway (same derivation as the web app) */
export function wsUrl(token: string): string {
  const base = API_URL
    .replace(/^http(s?):/, (_m: string, s: string) => `ws${s}:`)
    .replace(/\/v\d+\/?$/, "");
  return `${base}/ws?token=${encodeURIComponent(token)}`;
}
