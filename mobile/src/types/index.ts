export type ChatMode = 'AUTO' | 'DOCUMENT_RAG' | 'WEB_SEARCH' | 'MULTIMODAL' | 'IMAGE_GENERATION';

export interface MediaAttachment {
  id?: string;
  media_id?: string;
  url: string;
  file_type: 'image' | 'document';
  file_name?: string;
  mime_type?: string;
  file_size_bytes?: number;
  media_type?: 'upload' | 'generated';
  prompt?: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_url?: string | null;
  avatar_color?: string | null;
  is_verified?: boolean;
}

export interface GoogleAuthRequest {
  credential?: string;
  email?: string;
  name?: string;
  picture?: string;
  google_id?: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  mode: ChatMode;
  is_temporary?: boolean;
  expires_at?: string | null;
  is_pinned?: boolean;
  pinned_at?: string | null;
  message_count?: number;
  created_at: string;
  updated_at: string;
}

export type SessionSortOrder = 'last_created' | 'first_created';

export interface PaginatedChatSessions {
  sessions: ChatSession[];
  total: number;
  has_more: boolean;
  limit: number | null;
  offset: number;
}

export interface SessionListParams {
  limit?: number;
  offset?: number;
  search?: string;
  sort_by?: SessionSortOrder;
  signal?: AbortSignal;
}

export interface Citation {
  source_id?: number | string;
  document_id?: string;
  filename?: string;
  page_number?: number | null;
  chunk_index?: number | null;
  similarity_score?: number | null;
  snippet: string;
}

export interface MessageReplyReference {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sender_name?: string;
}

export interface Message {
  id: string;
  session_id?: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[] | null;
  attachments?: MediaAttachment[] | null;
  reply_to?: MessageReplyReference | null;
  created_at?: string;
}

export interface StreamingMessageState {
  content: string;
  citations: Citation[];
  attachments?: MediaAttachment[];
}

export interface StreamHandlers {
  onToken: (token: string) => void;
  onCitations: (citations: Citation[]) => void;
  onMedia?: (media: MediaAttachment) => void;
  onError: (error: string) => void;
  onComplete: () => void;
}

export interface DocumentMetadata {
  document_id: string;
  session_id: string;
  filename: string;
  file_type: string;
  file_size_bytes: number;
  total_chunks: number;
  storage_url?: string;
  uploaded_at: string;
}

export interface SessionHistoryResponse {
  session: ChatSession;
  messages: Message[];
  documents: DocumentMetadata[];
}

export interface AssetItem {
  id: string;
  user_id?: string | null;
  session_id?: string | null;
  session_title?: string | null;
  name: string;
  url: string;
  file_type: 'image' | 'document';
  mime_type?: string | null;
  size_bytes: number;
  origin: 'upload' | 'generated';
  prompt?: string;
  created_at: string;
}

export interface PaginatedAssetsResponse {
  items: AssetItem[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

export interface AssetQueryParams {
  userId?: string | null;
  sessionId?: string | null;
  origin?: 'upload' | 'generated' | 'all';
  fileType?: 'image' | 'document' | 'all';
  search?: string;
  limit?: number;
  offset?: number;
}
