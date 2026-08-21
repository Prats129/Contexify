import type {
  User,
  ChatSession,
  ChatMode,
  SessionHistoryResponse,
  DocumentUploadResponse,
  DocumentListResponse,
  StreamHandlers,
} from '../types';

const API_BASE_URL = '/api/v1';

export const apiService = {
  // --- User Endpoints ---
  async loginOrRegister(
    username: string,
    email: string | null = null,
    displayName: string | null = null
  ): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/user/login-or-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email,
        display_name: displayName,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to authenticate user' }));
      throw new Error(err.detail || 'Authentication failed');
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

  async listUsers(): Promise<User[]> {
    const response = await fetch(`${API_BASE_URL}/user/list`);
    if (!response.ok) {
      throw new Error('Failed to fetch user list');
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
    mode: ChatMode = 'DOCUMENT_RAG'
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
  async uploadDocument(file: File, sessionId: string): Promise<DocumentUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('session_id', sessionId);

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
    handlers: StreamHandlers
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

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
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
              } else if (parsed.event === 'done' && onDone) {
                onDone();
              }
            } catch (e) {
              console.error('Failed to parse SSE line:', line, e);
            }
          }
        }
      }

      if (onDone) onDone();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (onError) onError(errorMessage);
    }
  },
};
