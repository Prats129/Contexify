import type { User } from "../types";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface AuthSession {
  access_token: string;
  expires_at: number;
  is_guest: boolean;
  host: string;
}

/** Owns credential storage, guest issuance, expiry, and authenticated requests. */
export function createAuthTransport(authHost: () => Promise<string>) {
  const AUTH_KEY = "contexify_auth_session";
  const publicAuthPaths = new Set([
    "/user/register",
    "/user/login",
    "/user/auth/google",
    "/user/otp/send",
    "/user/otp/verify",
    "/user/auth/google/challenge",
    "/user/password-reset/send",
    "/user/password-reset/verify",
    "/user/guest",
  ]);
  const expiredHandlers = new Set<() => void>();
  let guestRequest: Promise<AuthSession> | null = null;
  let authGeneration = 0;

  const readAuth = async (): Promise<AuthSession | null> => {
    try {
      return JSON.parse((await AsyncStorage.getItem(AUTH_KEY)) || "null");
    } catch {
      return null;
    }
  };
  const saveAuth = async (session: AuthSession): Promise<void> => {
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(session));
  };
  const clearAuth = async (): Promise<void> => {
    authGeneration++;
    await AsyncStorage.removeItem(AUTH_KEY);
  };

  const getAuthSession = async (): Promise<AuthSession> => {
    const host = await authHost();
    const saved = await readAuth();
    if (
      saved?.access_token &&
      saved.host === host &&
      saved.expires_at * 1000 > Date.now()
    )
      return saved;
    if (saved && !saved.is_guest) {
      await clearAuth();
      expiredHandlers.forEach((handler) => handler());
      throw new Error("Your session expired. Please sign in again.");
    }
    if (!guestRequest) {
      const generation = authGeneration;
      guestRequest = (async () => {
        const response = await fetch(`${host}/api/v1/user/guest`, {
          method: "POST",
        });
        if (!response.ok) {
          const error = await response.json().catch(() => null);
          throw new Error(
            typeof error?.detail === "string"
              ? error.detail
              : "Unable to start a guest session.",
          );
        }
        const data = await response.json();
        if (generation !== authGeneration) {
          const current = await readAuth();
          if (current) return current;
          throw new Error("Your session changed. Please retry.");
        }
        const session: AuthSession = {
          access_token: data.access_token,
          expires_at: data.expires_at,
          is_guest: true,
          host,
        };
        await saveAuth(session);
        return session;
      })().finally(() => {
        guestRequest = null;
      });
    }
    return guestRequest;
  };

  const authHeaders = async (url: string): Promise<Record<string, string>> => {
    const session = await getAuthSession();
    if (session.host !== url.split("/api/v1")[0])
      throw new Error("The server changed. Please retry.");
    return { Authorization: `Bearer ${session.access_token}` };
  };

  const expireSession = async (authorization: string): Promise<void> => {
    const current = await readAuth();
    if (current && authorization === `Bearer ${current.access_token}`) {
      await clearAuth();
      expiredHandlers.forEach((handler) => handler());
    }
  };

  // Bound authentication requests even when the native transport ignores abort.
  // Do not retry sign-in/OTP requests automatically: they may have reached the server.
  const fetchAuthResponse = async (
    url: string,
    options: RequestInit = {},
  ): Promise<Response> => {
    if (options.signal?.aborted)
      throw new DOMException("Request cancelled", "AbortError");
    const controller = new AbortController();
    let rejectRequest!: (reason: Error) => void;
    const interrupted = new Promise<never>((_, reject) => {
      rejectRequest = reject;
    });
    const abort = () => {
      rejectRequest(new DOMException("Request cancelled", "AbortError"));
      controller.abort();
    };
    options.signal?.addEventListener("abort", abort);
    const timeout = setTimeout(() => {
      rejectRequest(
        new Error(
          "The server did not respond within 30 seconds. Check your connection and backend server address, then try again.",
        ),
      );
      controller.abort();
    }, 30000);
    try {
      return await Promise.race([
        fetch(url, { ...options, signal: controller.signal }),
        interrupted,
      ]);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  };

  const authenticatedFetch = async (
    url: string,
    options: RequestInit = {},
  ): Promise<Response> => {
    const path = url.split("/api/v1")[1]?.split("?")[0] || "";
    if (publicAuthPaths.has(path)) return fetchAuthResponse(url, options);
    if (path === "/health") return fetch(url, options);
    const headers = new Headers(options.headers);
    const authorization = await authHeaders(url);
    headers.set("Authorization", authorization.Authorization);
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401)
      await expireSession(authorization.Authorization);
    const current = await readAuth();
    if (url.split("/api/v1")[0] !== (await authHost()))
      throw new Error("The server changed. Please retry.");
    if (
      !current ||
      authorization.Authorization !== `Bearer ${current.access_token}`
    )
      throw new Error("Your session changed. Please retry.");
    return response;
  };

  const acceptLogin = async (
    response: Response,
    requestUrl: string,
  ): Promise<User> => {
    const host = requestUrl.split("/api/v1")[0];
    if (host !== (await authHost()))
      throw new Error("The server changed. Please sign in again.");
    const {
      access_token,
      token_type: _tokenType,
      expires_at,
      ...user
    } = await response.json();
    if (!access_token || !expires_at)
      throw new Error("The server did not issue authentication credentials.");
    authGeneration++;
    await saveAuth({ access_token, expires_at, is_guest: false, host });
    return user as User;
  };

  return {
    authenticatedFetch,
    acceptLogin,
    authHeaders,
    readAuth,
    expireSession,
    onSessionExpired(handler: () => void): () => void {
      expiredHandlers.add(handler);
      return () => {
        expiredHandlers.delete(handler);
      };
    },
    async hasUserSession(): Promise<boolean> {
      const session = await readAuth();
      return Boolean(
        session &&
        !session.is_guest &&
        session.access_token &&
        session.host === (await authHost()) &&
        session.expires_at * 1000 > Date.now(),
      );
    },
    async logout(): Promise<void> {
      const session = await readAuth();
      await clearAuth();
      if (session?.access_token && session.host === (await authHost())) {
        await fetch(`${session.host}/api/v1/user/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).catch(() => undefined);
      }
    },
  };
}
