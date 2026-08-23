/**
 * Core TypeScript definitions for Contexify AI
 */

export type ChatMode = 'DOCUMENT_RAG' | 'WEB_SEARCH' | 'MULTIMODAL';

export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_color?: string;
  created_at: string;
}

export interface UserRegisterRequest {
  username: string;
  display_name: string;
  email: string;
  password: string;
}

export interface UserLoginRequest {
  username_or_email: string;
  password: string;
}

export interface UserProfileUpdateRequest {
  user_id: string;
  display_name?: string;
  avatar_color?: string;
}

export interface UserPasswordChangeRequest {
  user_id: string;
  old_password: string;
  new_password: string;
}


export interface Citation {
  document_id: string;
  filename: string;
  page_number?: number | null;
  chunk_index: number;
  snippet: string;
  similarity_score: number;
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[] | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  mode: ChatMode;
  created_at: string;
  updated_at: string;
  message_count?: number;
  document_count?: number;
}

export interface DocumentMetadata {
  document_id: string;
  filename: string;
  file_type: string;
  file_size_bytes: number;
  total_chunks: number;
  uploaded_at: string;
}

export interface DocumentUploadResponse {
  document: DocumentMetadata;
  message: string;
}

export interface DocumentListResponse {
  documents: DocumentMetadata[];
  total_count: number;
}

export interface DocumentChunkItem {
  chunk_id: string;
  chunk_index: number;
  page_number?: number | null;
  text: string;
}

export interface DocumentChunksResponse {
  document_id: string;
  filename: string;
  total_chunks: number;
  chunks: DocumentChunkItem[];
}


export interface SessionHistoryResponse {
  session: ChatSession;
  messages: Message[];
  documents: DocumentMetadata[];
}

export interface StreamHandlers {
  onCitations?: (citations: Citation[]) => void;
  onToken?: (token: string) => void;
  onError?: (error: string) => void;
  onDone?: () => void;
}

export interface StreamingMessageState {
  role: 'assistant';
  content: string;
  citations?: Citation[] | null;
  isStreaming: boolean;
  isError: boolean;
}
