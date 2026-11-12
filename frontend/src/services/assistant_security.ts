import type { DeviceResponse, WebSessionResponse, SecuritySessionResponse } from "../types/api-contracts";

/** Isolated cookie authority. Tokens/commands are never persisted or sent to chat. */
export function createAssistantWebSecurity(
  getHost: () => Promise<string>,
  bootstrapHeaders: (url: string) => Promise<Record<string, string>>,
) {
  let session: { host: string; csrf: string; expiresAt: number; account: string } | null = null;
  let generation = 0;

  async function fingerprint(authorization: string): Promise<string> {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(authorization));
    return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function accountIdentity(): Promise<string> {
    const headers = await bootstrapHeaders(`${await getHost()}/api/v1/assistant/security/web-session`);
    return fingerprint(headers.Authorization);
  }

  async function boundedFetch(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Assistant security request timed out. Check its status before trying again."));
      }, 15000);
    });
    try { return await Promise.race([fetch(url, { ...options, signal: controller.signal }), timeout]); }
    finally { clearTimeout(timer!); }
  }

  async function host(): Promise<string> {
    const selected = await getHost();
    const origin = selected || window.location.origin;
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password || url.search || url.hash)
      throw new Error("Assistant security requires an HTTPS server origin.");
    return url.origin;
  }

  async function request<T>(path: string, method = "GET"): Promise<T> {
    const current = session;
    if (!current || current.expiresAt * 1000 <= Date.now() || current.host !== await host())
      throw new Error("Enable assistant security after signing in again.");
    if (current.account !== await accountIdentity()) {
      session = null;
      throw new Error("Your sign-in changed. Enable assistant security again.");
    }
    const response = await boundedFetch(`${current.host}/api/v1/assistant/security${path}`, {
      method, credentials: "include", redirect: "error", cache: "no-store",
      headers: { "X-Contexify-Assistant": "1", "X-CSRF-Token": current.csrf },
    });
    if (session !== current) throw new Error("Your assistant session changed.");
    if (!response.ok) {
      if ([401, 403].includes(response.status)) session = null;
      throw new Error("Assistant security request was rejected. Enable it again after signing in.");
    }
    const data = response.status === 204 ? undefined : await response.json();
    if (session !== current || current.account !== await accountIdentity())
      throw new Error("Your sign-in changed. Enable assistant security again.");
    return data as T;
  }

  return {
    async enable(): Promise<void> {
      const selectedHost = await host();
      const version = ++generation;
      const url = `${selectedHost}/api/v1/assistant/security/web-session`;
      // Existing chat transports may use relative API URLs; preserve that binding.
      const bootstrapUrl = `${await getHost()}/api/v1/assistant/security/web-session`;
      const headers = await bootstrapHeaders(bootstrapUrl);
      const account = await fingerprint(headers.Authorization);
      const response = await boundedFetch(url, {
        method: "POST", credentials: "include", redirect: "error", cache: "no-store",
        headers: { ...headers, "Content-Type": "application/json", "X-Contexify-Assistant": "1" },
        body: "{}",
      });
      if (!response.ok) throw new Error("Sign in again before enabling assistant security.");
      const data: WebSessionResponse = await response.json();
      if (version !== generation || selectedHost !== await host() || account !== await accountIdentity())
        throw new Error("Your assistant session changed.");
      session = { host: selectedHost, csrf: data.csrf_token, expiresAt: data.expires_at, account };
    },
    async status(): Promise<SecuritySessionResponse> { return request("/session"); },
    async devices(): Promise<DeviceResponse[]> { return request("/devices"); },
    async revokeDevice(deviceId: string): Promise<void> {
      if (!/^[a-f0-9-]{36}$/.test(deviceId)) throw new Error("Invalid device identifier.");
      await request(`/devices/${deviceId}`, "DELETE");
    },
    async disable(): Promise<void> {
      generation++;
      try { if (session) await request("/session", "DELETE"); }
      finally { session = null; }
    },
  };
}
