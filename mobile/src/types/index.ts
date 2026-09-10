export type ChatMode = 'DOCUMENT_RAG' | 'WEB_SEARCH' | 'MULTIMODAL';

export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_url?: string | null;
  avatar_color?: string | null;
  is_verified?: boolean;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  mode: ChatMode;
  message_count?: number;
  created_at: string;
  updated_at: string;
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

export interface Message {
  id: string;
  session_id?: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[] | null;
  created_at?: string;
}

export interface StreamingMessageState {
  content: string;
  citations: Citation[];
}

export interface DocumentMetadata {
  document_id: string;
  session_id: string;
  filename: string;
  file_type: string;
  file_size_bytes: number;
  total_chunks: number;
  uploaded_at: string;
}

export interface SessionHistoryResponse {
  session: ChatSession;
  messages: Message[];
  documents: DocumentMetadata[];
}
