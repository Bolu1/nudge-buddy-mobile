import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

// Tokens live in the keychain/keystore; a memory copy keeps reads synchronous
// (the API client and websocket read them on every call).
const ACCESS_KEY = "nb_token";
const REFRESH_KEY = "nb_refresh_token";

let accessToken: string | null = null;
let refreshToken: string | null = null;

export async function loadTokens(): Promise<string | null> {
  try {
    [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
    ]);
  } catch {
    accessToken = refreshToken = null;
  }
  return accessToken;
}

export function getToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export async function setTokens(access: string, refresh?: string | null) {
  accessToken = access;
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  if (refresh) {
    refreshToken = refresh;
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  }
}

export async function clearAllTokens() {
  accessToken = refreshToken = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => {}),
  ]);
}

// ── Plain preferences (non-secret), with a sync in-memory cache ─────────────

const prefCache = new Map<string, string | null>();

export async function loadPrefs(keys: string[]) {
  try {
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [k, v] of pairs) prefCache.set(k, v);
  } catch { /* ignore */ }
}

export function getPref(key: string): string | null {
  return prefCache.get(key) ?? null;
}

export function setPref(key: string, value: string | null) {
  prefCache.set(key, value);
  if (value === null) AsyncStorage.removeItem(key).catch(() => {});
  else AsyncStorage.setItem(key, value).catch(() => {});
}
