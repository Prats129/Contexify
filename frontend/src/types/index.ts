/**
 * Core TypeScript definitions for Contexify AI
 */

export type ChatMode = 'AUTO' | 'DOCUMENT_RAG' | 'WEB_SEARCH' | 'MULTIMODAL' | 'IMAGE_GENERATION';

export interface MediaAttachment {
  id?: string;
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
  avatar_color?: string;
  avatar_url?: string | null;
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
  avatar_url?: string | null;
}

export interface UserPasswordChangeRequest {
  user_id: string;
  old_password: string;
  new_password: string;
}

export interface SendOtpRequest {
  email_or_username: string;
}

export interface SendOtpResponse {
  message: string;
  email: string;
  masked_email: string;
  expires_in_seconds: number;
  cooldown_seconds: number;
}

export interface VerifyOtpLoginRequest {
  email_or_username: string;
  otp: string;
}

export interface ResetPasswordWithOtpRequest {
  email_or_username: string;
  otp: string;
  new_password: string;
}

export interface GoogleAuthRequest {
  credential?: string;
  email?: string;
  name?: string;
  picture?: string;
  google_id?: string;
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
  attachments?: MediaAttachment[] | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  mode: ChatMode;
  is_temporary?: boolean;
  expires_at?: string | null;
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
  onMedia?: (media: MediaAttachment) => void;
  onToken?: (token: string) => void;
  onError?: (error: string) => void;
  onDone?: () => void;
}

export interface StreamingMessageState {
  role: 'assistant';
  content: string;
  citations?: Citation[] | null;
  attachments?: MediaAttachment[] | null;
  isStreaming: boolean;
  isError: boolean;
}
