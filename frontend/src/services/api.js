/**
 * API Service for Knowledge AI Engine
 */
const API_BASE_URL = '/api/v1';

class ApiService {
    /**
     * Upload and vectorize a document file
     */
    async uploadDocument(file, sessionId) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('session_id', sessionId);

        const response = await fetch(`${API_BASE_URL}/document/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'Upload failed' }));
            throw new Error(errorData.detail || 'Upload failed');
        }

        return await response.json();
    }

    /**
     * List attached documents for a chat session
     */
    async listDocuments(sessionId) {
        const response = await fetch(`${API_BASE_URL}/document/list?session_id=${encodeURIComponent(sessionId)}`);
        if (!response.ok) {
            throw new Error('Failed to fetch document list');
        }
        return await response.json();
    }

    /**
     * Delete document and purge vectors
     */
    async deleteDocument(documentId, sessionId) {
        const response = await fetch(`${API_BASE_URL}/document/${documentId}?session_id=${encodeURIComponent(sessionId)}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            throw new Error('Failed to delete document');
        }
        return await response.json();
    }

    /**
     * Stream Chat SSE Response
     */
    async streamChat(sessionId, message, mode, handlers) {
        const { onCitations, onToken, onError, onDone } = handlers;

        try {
            const response = await fetch(`${API_BASE_URL}/chat/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    message: message,
                    mode: mode
                })
            });

            if (!response.ok) {
                throw new Error(`Server returned HTTP ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop(); // keep last incomplete chunk

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
        } catch (err) {
            if (onError) onError(err.message);
        }
    }
}

const apiService = new ApiService();
