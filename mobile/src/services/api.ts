import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type {
  User,
  ChatSession,
  ChatMode,
  SessionHistoryResponse,
  DocumentMetadata,
  Citation,
} from '../types';

// Default development IP matching your current Wi-Fi network (10.66.137.54:8001)
const DEFAULT_WIFI_IP = '10.66.137.54';
const DEFAULT_HOST: string = Platform.select({
  android: `http://${DEFAULT_WIFI_IP}:8001`,
  ios: `http://${DEFAULT_WIFI_IP}:8001`,
  default: 'http://localhost:8001',
}) || 'http://localhost:8001';

let cachedBaseUrl: string | null = null;

export const getApiBaseUrl = async (): Promise<string> => {
  if (cachedBaseUrl) return cachedBaseUrl;
  try {
    const saved = await AsyncStorage.getItem('contexify_server_url');
    if (saved && saved.trim()) {
      const clean = saved.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
      cachedBaseUrl = clean;
      return clean;
    }
  } catch {}

  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl && envUrl.trim()) {
    const clean = envUrl.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
    cachedBaseUrl = clean;
    return clean;
  }

  cachedBaseUrl = DEFAULT_HOST;
  return DEFAULT_HOST;
};

export const setApiBaseUrl = async (newUrl: string) => {
  const clean = newUrl.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
  cachedBaseUrl = clean;
  await AsyncStorage.setItem('contexify_server_url', clean);
};

export const resetApiBaseUrl = async () => {
  cachedBaseUrl = DEFAULT_HOST;
  await AsyncStorage.removeItem('contexify_server_url');
};

const getCleanHost = async (): Promise<string> => {
  const base = await getApiBaseUrl();
  return base.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
};

const getEndpoint = async (path: string): Promise<string> => {
  const host = await getCleanHost();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${host}/api/v1${cleanPath}`;
};

/**
 * Upload multipart form data using native XMLHttpRequest.
 * Bypasses Expo 57's WinterCG fetch polyfill which throws
 * "Unsupported FormDataPart implementation" when passing React Native's { uri, name, type } object.
 */
function uploadMultipart<T>(url: string, formData: FormData): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.timeout = 60000;

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch {
          resolve(xhr.responseText as any);
        }
      } else {
        let errorDetail = `Upload failed (${xhr.status})`;
        try {
          const err = JSON.parse(xhr.responseText);
          if (err.detail) {
            errorDetail = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail);
          }
        } catch {}
        reject(new Error(errorDetail));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during file upload. Please verify backend connection.'));
    };

    xhr.ontimeout = () => {
      reject(new Error('File upload timed out. Please try again.'));
    };

    xhr.send(formData);
  });
}

export interface StreamHandlers {
  onToken: (token: string) => void;
  onCitations: (citations: Citation[]) => void;
  onComplete: () => void;
  onError: (err: string) => void;
}

export const apiService = {
  // --- Health Check ---
  async pingHealth(): Promise<boolean> {
    try {
      const url = await getEndpoint('/health');
      const res = await fetch(url, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  },

  // --- Authentication ---
  async register(
    displayName: string,
    username: string,
    email: string,
    password: string
  ): Promise<User> {
    const url = await getEndpoint('/user/register');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: displayName,
        username,
        email,
        password,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Registration failed' }));
      throw new Error(err.detail || 'Registration failed');
    }
    return res.json();
  },

  async login(usernameOrEmail: string, password: string): Promise<User> {
    const url = await getEndpoint('/user/login');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username_or_email: usernameOrEmail,
        password,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Invalid credentials' }));
      throw new Error(err.detail || 'Invalid credentials');
    }
    return res.json();
  },

  async sendOtp(emailOrUsername: string): Promise<{ message: string; cooldown_seconds: number }> {
    const url = await getEndpoint('/user/otp/send');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_or_username: emailOrUsername }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to send OTP' }));
      throw new Error(err.detail || 'Failed to send OTP');
    }
    return res.json();
  },

  async loginWithOtp(emailOrUsername: string, otp: string): Promise<User> {
    const url = await getEndpoint('/user/otp/verify');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_or_username: emailOrUsername,
        otp,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Invalid or expired OTP' }));
      throw new Error(err.detail || 'Invalid or expired OTP');
    }
    return res.json();
  },

  async updateUserProfile(
    userId: string,
    displayName?: string,
    avatarColor?: string
  ): Promise<User> {
    const url = await getEndpoint('/user/profile');
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        display_name: displayName,
        avatar_color: avatarColor,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to update profile' }));
      throw new Error(err.detail || 'Failed to update profile');
    }
    return res.json();
  },

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<{ message: string }> {
    const url = await getEndpoint('/user/change-password');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        old_password: oldPassword,
        new_password: newPassword,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to change password' }));
      throw new Error(err.detail || 'Failed to change password');
    }
    return res.json();
  },

  async getCurrentUser(userId: string): Promise<User | null> {
    try {
      const url = await getEndpoint(`/user/me?user_id=${encodeURIComponent(userId)}`);
      const res = await fetch(url);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },

  async uploadAvatar(
    userId: string,
    fileUri: string,
    fileName: string,
    mimeType: string = 'image/jpeg'
  ): Promise<User> {
    let safeName = fileName || 'avatar.jpg';
    if (!/\.(png|jpe?g|webp|gif)$/i.test(safeName)) {
      const ext = mimeType.includes('png')
        ? '.png'
        : mimeType.includes('webp')
          ? '.webp'
          : mimeType.includes('gif')
            ? '.gif'
            : '.jpg';
      safeName = `${safeName}${ext}`;
    }

    // Native XMLHttpRequest multipart upload directly to /user/avatar.
    // Universally supported by Render and local backends. Bypasses Expo 57 fetch polyfill.
    const url = await getEndpoint('/user/avatar');
    const formData = new FormData();
    formData.append('user_id', userId);
    formData.append('file', {
      uri: fileUri,
      name: safeName,
      type: mimeType || 'image/jpeg',
    } as any);

    return uploadMultipart<User>(url, formData);
  },

  async deleteAvatar(userId: string): Promise<User> {
    const url = await getEndpoint(`/user/avatar?user_id=${encodeURIComponent(userId)}`);
    const res = await fetch(url, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to remove photo' }));
      throw new Error(err.detail || 'Failed to remove photo');
    }
    return res.json();
  },

  async resolveAvatarUrl(avatarUrl?: string | null): Promise<string | null> {
    if (!avatarUrl || !avatarUrl.trim()) return null;
    let clean = avatarUrl.trim();

    // Dicebear SVGs cannot be decoded natively by React Native <Image>.
    // Convert /svg to /png format supported directly by Dicebear CDN.
    if (clean.includes('api.dicebear.com') && clean.includes('/svg')) {
      clean = clean.replace('/svg', '/png');
    }

    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      return clean;
    }

    const host = await getCleanHost();
    const path = clean.startsWith('/') ? clean : `/${clean}`;
    if (!path.startsWith('/api/v1')) {
      return `${host}/api/v1${path}`;
    }
    return `${host}${path}`;
  },

  // --- Sessions & History ---
  async getUserSessions(userId: string): Promise<ChatSession[]> {
    try {
      if (!userId || userId.startsWith('guest')) return [];
      const url = await getEndpoint(`/session/list?user_id=${encodeURIComponent(userId)}`);
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  async getSessionHistory(sessionId: string): Promise<SessionHistoryResponse> {
    try {
      const url = await getEndpoint(`/session/${encodeURIComponent(sessionId)}/history`);
      const res = await fetch(url);
      if (!res.ok) {
        return { session: null as any, messages: [], documents: [] };
      }
      const data = await res.json();
      return {
        session: data?.session || null,
        messages: Array.isArray(data?.messages) ? data.messages : [],
        documents: Array.isArray(data?.documents) ? data.documents : [],
      };
    } catch {
      return { session: null as any, messages: [], documents: [] };
    }
  },

  async createSession(userId: string, title: string, mode: ChatMode): Promise<ChatSession> {
    const url = await getEndpoint('/session/create');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, title, mode }),
    });
    if (!res.ok) throw new Error('Failed to create conversation');
    return res.json();
  },

  async deleteSession(sessionId: string): Promise<void> {
    const url = await getEndpoint(`/session/${encodeURIComponent(sessionId)}`);
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete session');
  },

  async updateSessionMode(sessionId: string, mode: ChatMode): Promise<void> {
    const url = await getEndpoint(`/session/${encodeURIComponent(sessionId)}/mode`);
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
  },

  // --- Documents ---
  async getSessionDocuments(sessionId: string): Promise<DocumentMetadata[]> {
    try {
      const url = await getEndpoint(`/document/session/${encodeURIComponent(sessionId)}`);
      const res = await fetch(url);
      if (!res.ok) return [];
      return res.json();
    } catch {
      return [];
    }
  },

  async uploadDocument(
    sessionId: string,
    fileUri: string,
    fileName: string,
    mimeType: string = 'application/pdf',
    userId?: string
  ): Promise<DocumentMetadata> {
    const url = await getEndpoint('/document/upload');
    const formData = new FormData();
    formData.append('session_id', sessionId);
    if (userId) {
      formData.append('user_id', userId);
    }
    formData.append('file', {
      uri: fileUri,
      name: fileName || 'document.pdf',
      type: mimeType || 'application/octet-stream',
    } as any);

    const data = await uploadMultipart<{ document?: DocumentMetadata } & DocumentMetadata>(
      url,
      formData
    );
    return data.document || data;
  },

  async deleteDocument(documentId: string, sessionId: string): Promise<void> {
    const url = await getEndpoint(
      `/document/${encodeURIComponent(documentId)}?session_id=${encodeURIComponent(sessionId)}`
    );
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to remove document');
  },

  // --- Real-time SSE Chat Stream ---
  streamChat(
    sessionId: string,
    query: string,
    mode: ChatMode,
    handlers: StreamHandlers
  ): () => void {
    let isAborted = false;
    let hasEnded = false;
    const xhr = new XMLHttpRequest();

    const triggerComplete = () => {
      if (hasEnded || isAborted) return;
      hasEnded = true;
      handlers.onComplete();
    };

    const triggerError = (errMsg: string) => {
      if (hasEnded || isAborted) return;
      hasEnded = true;
      handlers.onError(errMsg);
    };

    getEndpoint('/chat/stream').then((url) => {
      if (isAborted || hasEnded) return;

      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'text/event-stream');

      let lastIndex = 0;

      const processChunks = () => {
        const currText = xhr.responseText || '';
        if (currText.length <= lastIndex) return;
        const newChunks = currText.substring(lastIndex);
        lastIndex = currText.length;

        const lines = newChunks.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const payload = trimmed.substring(6).trim();

          if (payload === '[DONE]') {
            triggerComplete();
            return;
          }

          try {
            const data = JSON.parse(payload);
            if (data.event === 'citations' && data.citations) {
              handlers.onCitations(data.citations);
            } else if (data.event === 'token' && typeof data.data === 'string') {
              handlers.onToken(data.data);
            } else if (data.event === 'error') {
              triggerError(data.data || 'Streaming error encountered');
              return;
            } else if (data.event === 'done') {
              triggerComplete();
              return;
            } else if (data.token) {
              handlers.onToken(data.token);
            } else if (data.citations && Array.isArray(data.citations)) {
              handlers.onCitations(data.citations);
            } else if (data.error) {
              triggerError(data.error);
              return;
            }
          } catch {
            // Partial JSON chunk, continue
          }
        }
      };

      xhr.onprogress = () => {
        if (hasEnded || isAborted) return;
        processChunks();
      };

      xhr.onload = () => {
        if (isAborted || hasEnded) return;
        if (xhr.status >= 400) {
          triggerError(`Server error: ${xhr.status}`);
        } else {
          processChunks();
          triggerComplete();
        }
      };

      xhr.onerror = () => {
        if (!isAborted && !hasEnded) {
          triggerError('Network connection error with backend server');
        }
      };

      xhr.onabort = () => {
        // Aborted cleanly
      };

      xhr.send(
        JSON.stringify({
          session_id: sessionId,
          message: query,
          query,
          mode,
        })
      );
    });

    // Return cancellation function
    return () => {
      isAborted = true;
      hasEnded = true;
      try {
        xhr.abort();
      } catch {}
    };
  },
};
