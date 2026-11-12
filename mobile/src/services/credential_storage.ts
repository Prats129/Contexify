import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const AUTH_KEY = "contexify_auth_session";
const options = {
  keychainService: "ai.contexify.credentials.v1",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
let operations: Promise<unknown> = Promise.resolve();
let webSession: string | null = null;

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const pending = operations.then(operation);
  operations = pending.catch(() => undefined);
  return pending;
}

function validLegacy(value: string): boolean {
  try {
    const session = JSON.parse(value);
    const url = new URL(session.host);
    return typeof session.access_token === "string" && session.access_token.length >= 16 &&
      session.access_token.length <= 512 && typeof session.is_guest === "boolean" &&
      typeof session.expires_at === "number" && Number.isFinite(session.expires_at) &&
      session.expires_at * 1000 > Date.now() && ["http:", "https:"].includes(url.protocol) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

async function available(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    // Never use plaintext storage when the installed binary lacks this module.
    await AsyncStorage.removeItem(AUTH_KEY);
    throw new Error("Secure credential storage is unavailable. Install the updated app and sign in again.");
  }
}

/** Credential operations are serialized so migration cannot race logout/login. */
export const credentialStorage = {
  get: () => serialized(async () => {
    if (Platform.OS === "web") {
      await AsyncStorage.removeItem(AUTH_KEY);
      return webSession;
    }
    await available();
    const saved = await SecureStore.getItemAsync(AUTH_KEY, options);
    const legacy = await AsyncStorage.getItem(AUTH_KEY);
    if (saved !== null) {
      await AsyncStorage.removeItem(AUTH_KEY);
      return saved;
    }
    if (legacy && validLegacy(legacy)) {
      try {
        await SecureStore.setItemAsync(AUTH_KEY, legacy, options);
        if ((await SecureStore.getItemAsync(AUTH_KEY, options)) !== legacy)
          throw new Error("Secure storage readback failed");
      } catch {
        // An interrupted/failed upgrade must require sign-in, not leave a
        // reusable plaintext copy for an older binary or a restored backup.
        try { await SecureStore.deleteItemAsync(AUTH_KEY, options); } catch { /* Fail closed below. */ }
        throw new Error("Credential migration failed. Please sign in again.");
      } finally {
        await AsyncStorage.removeItem(AUTH_KEY);
      }
      return legacy;
    }
    await AsyncStorage.removeItem(AUTH_KEY);
    return null;
  }),
  set: (value: string) => serialized(async () => {
    if (Platform.OS === "web") webSession = value;
    else {
      await available();
      await SecureStore.setItemAsync(AUTH_KEY, value, options);
    }
    await AsyncStorage.removeItem(AUTH_KEY);
  }),
  clear: () => serialized(async () => {
    webSession = null;
    // Remove the legacy copy even when keychain access has failed.
    await AsyncStorage.removeItem(AUTH_KEY);
    if (Platform.OS !== "web") {
      await available();
      await SecureStore.deleteItemAsync(AUTH_KEY, options);
    }
  }),
};
