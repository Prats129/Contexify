import type {
  User,
  ChatSession,
  ChatMode,
  SessionHistoryResponse,
  DocumentUploadResponse,
  DocumentListResponse,
  StreamHandlers,
  SendOtpResponse,
  GoogleAuthRequest,
} from '../types';

const API_BASE_URL = '/api/v1';

export const apiService = {
  // --- User Authentication Endpoints ---
  async register(
    displayName: string,
    username: string,
    email: string,
    password: string
  ): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: displayName,
        username,
        email,
        password,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Registration failed' }));
      throw new Error(err.detail || 'Registration failed');
    }
    return await response.json();
  },

  async login(
    usernameOrEmail: string,
    password: string
  ): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username_or_email: usernameOrEmail,
        password,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Authentication failed' }));
      throw new Error(err.detail || 'Invalid username/email or password');
    }
    return await response.json();
  },

  async loginWithGoogle(data: GoogleAuthRequest): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/user/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Google authentication failed' }));
      throw new Error(err.detail || 'Google authentication failed');
    }
    return await response.json();
  },

  async sendLoginOtp(emailOrUsername: string): Promise<SendOtpResponse> {
    const response = await fetch(`${API_BASE_URL}/user/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_or_username: emailOrUsername,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to send verification code' }));
      throw new Error(err.detail || 'Failed to send verification code');
    }
    return await response.json();
  },

  async loginWithOtp(
    emailOrUsername: string,
    otp: string
  ): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/user/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_or_username: emailOrUsername,
        otp,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Invalid verification code' }));
      throw new Error(err.detail || 'Invalid verification code');
    }
    return await response.json();
  },

  async sendPasswordResetOtp(emailOrUsername: string): Promise<SendOtpResponse> {
    const response = await fetch(`${API_BASE_URL}/user/password-reset/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_or_username: emailOrUsername,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to send password reset code' }));
      throw new Error(err.detail || 'Failed to send password reset code');
    }
    return await response.json();
  },

  async resetPasswordWithOtp(
    emailOrUsername: string,
    otp: string,
    newPassword: string
  ): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE_URL}/user/password-reset/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_or_username: emailOrUsername,
        otp,
        new_password: newPassword,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to reset password' }));
      throw new Error(err.detail || 'Failed to reset password');
    }
    return await response.json();
  },

  async getCurrentUser(userId: string): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/user/me?user_id=${encodeURIComponent(userId)}`);
    if (!response.ok) {
      throw new Error('User not found');
    }
    return await response.json();
  },

  async updateUserProfile(
    userId: string,
    displayName?: string,
    avatarColor?: string
  ): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/user/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        display_name: displayName,
        avatar_color: avatarColor,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Profile update failed' }));
      throw new Error(err.detail || 'Profile update failed');
    }
    return await response.json();
  },

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE_URL}/user/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        old_password: oldPassword,
        new_password: newPassword,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Password change failed' }));
      throw new Error(err.detail || 'Password change failed');
    }
    return await response.json();
  },

  async uploadAvatar(userId: string, file: File): Promise<User> {
    const MAX_SIZE = 2 * 1024 * 1024; // 2MB
    if (file.size > MAX_SIZE) {
      throw new Error('Avatar image exceeds maximum file size limit of 2MB.');
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type.toLowerCase()) && !/\.(png|jpg|jpeg|webp|gif)$/i.test(file.name)) {
      throw new Error('Invalid image format. Allowed formats: PNG, JPG, JPEG, WEBP, GIF.');
    }

    const formData = new FormData();
    formData.append('user_id', userId);
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/user/avatar`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Avatar upload failed' }));
      throw new Error(err.detail || 'Avatar upload failed');
    }

    return await response.json();
  },

  async deleteAvatar(userId: string): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/user/avatar?user_id=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Avatar deletion failed' }));
      throw new Error(err.detail || 'Avatar deletion failed');
    }

    return await response.json();
  },

  // --- Session Endpoints ---
  async listSessions(userId: string): Promise<ChatSession[]> {
    const response = await fetch(`${API_BASE_URL}/session/list?user_id=${encodeURIComponent(userId)}`);
    if (!response.ok) {
      throw new Error('Failed to fetch session list');
    }
    return await response.json();
  },

  async createSession(
    userId: string,
    title: string = 'New Conversation',
    mode: ChatMode = 'WEB_SEARCH'
  ): Promise<ChatSession> {
    const response = await fetch(`${API_BASE_URL}/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        title,
        mode,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to create session' }));
      throw new Error(err.detail || 'Failed to create session');
    }
    return await response.json();
  },

  async getSessionHistory(sessionId: string): Promise<SessionHistoryResponse> {
    const response = await fetch(`${API_BASE_URL}/session/${encodeURIComponent(sessionId)}/history`);
    if (!response.ok) {
      throw new Error('Failed to fetch session history');
    }
    return await response.json();
  },

  async updateSessionTitle(sessionId: string, title: string): Promise<{ message: string; title: string }> {
    const response = await fetch(`${API_BASE_URL}/session/${encodeURIComponent(sessionId)}/title`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error('Failed to update session title');
    }
    return await response.json();
  },

  async updateSessionMode(sessionId: string, mode: ChatMode): Promise<{ message: string; mode: ChatMode }> {
    const response = await fetch(`${API_BASE_URL}/session/${encodeURIComponent(sessionId)}/mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!response.ok) {
      throw new Error('Failed to update session mode');
    }
    return await response.json();
  },

  async clearSessionMessages(sessionId: string): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE_URL}/session/${encodeURIComponent(sessionId)}/messages`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to clear messages');
    }
    return await response.json();
  },

  async deleteSession(sessionId: string): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE_URL}/session/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete session');
    }
    return await response.json();
  },

  // --- Document Endpoints ---
  async uploadDocument(file: File, sessionId: string, userId?: string): Promise<DocumentUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('session_id', sessionId);
    if (userId) {
      formData.append('user_id', userId);
    }

    const response = await fetch(`${API_BASE_URL}/document/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(errorData.detail || 'Upload failed');
    }

    return await response.json();
  },

  async listDocuments(sessionId: string): Promise<DocumentListResponse> {
    const response = await fetch(`${API_BASE_URL}/document/list?session_id=${encodeURIComponent(sessionId)}`);
    if (!response.ok) {
      throw new Error('Failed to fetch document list');
    }
    return await response.json();
  },

  async getDocumentChunks(documentId: string): Promise<import('../types').DocumentChunksResponse> {
    const response = await fetch(`${API_BASE_URL}/document/${encodeURIComponent(documentId)}/chunks`);
    if (!response.ok) {
      throw new Error('Failed to fetch document chunks');
    }
    return await response.json();
  },

  async deleteDocument(documentId: string, sessionId: string): Promise<{ message: string }> {
    const response = await fetch(
      `${API_BASE_URL}/document/${encodeURIComponent(documentId)}?session_id=${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to delete document');
    }
    return await response.json();
  },


  // --- Streaming Chat (SSE) ---
  async streamChat(
    sessionId: string,
    message: string,
    mode: ChatMode,
    handlers: StreamHandlers,
    signal?: AbortSignal
  ): Promise<void> {
    const { onCitations, onToken, onError, onDone } = handlers;

    try {
      const response = await fetch(`${API_BASE_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          message,
          mode,
        }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let hasCompleted = false;

      const triggerDone = () => {
        if (!hasCompleted) {
          hasCompleted = true;
          if (onDone) onDone();
        }
      };

      while (true) {
        if (signal?.aborted) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          break;
        }

        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (signal?.aborted) break;
          if (line.startsWith('data: ')) {
            const jsonStr = line.replace('data: ', '').trim();
            if (!jsonStr) continue;

            try {
              const parsed = JSON.parse(jsonStr);

              if (parsed.event === 'citations' && onCitations) {
                onCitations(parsed.citations);
              } else if (parsed.event === 'token' && onToken) {
                onToken(parsed.data);
              } else if (parsed.event === 'error' && onError) {
                onError(parsed.data);
              } else if (parsed.event === 'done') {
                triggerDone();
              }
            } catch (e) {
              console.error('Failed to parse SSE line:', line, e);
            }
          }
        }
      }

      if (!signal?.aborted) {
        triggerDone();
      }
    } catch (err: unknown) {
      if (
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.name === 'AbortError') ||
        signal?.aborted
      ) {
        // Stream was stopped by the user - do not treat as an error
        return;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (onError) onError(errorMessage);
    }
  },
};

