import type * as Wire from "./api-contracts";

// Wire shapes come from the backend; these projections describe client/UI state.
export type {
  ChatMode,
  GoogleAuthRequest,
  MessageAcknowledgement,
  SendOtpResponse,
  UserRegisterRequest,
  UserLoginRequest,
  UserProfileUpdateRequest,
  UserPasswordChangeRequest,
  SendOtpRequest,
  VerifyOtpLoginRequest,
  ResetPasswordWithOtpRequest,
  DocumentUploadResponse,
  DocumentListResponse,
  DocumentChunkItem,
  DocumentChunksResponse,
} from "./api-contracts";

// UI attachments omit null values and require a usable URL and known file kind.
type DefinedFields<T> = { [K in keyof T]: Exclude<T[K], null> };
export type MediaAttachment = Omit<
  DefinedFields<Wire.MediaAttachment>,
  "url" | "file_type" | "media_type"
> & {
  url: string;
  file_type: "image" | "document";
  media_type?: "upload" | "generated";
};
export type ChatSession = Wire.ChatSessionResponse;
export type PaginatedChatSessions = Wire.PaginatedChatSessionsResponse;
export type SessionSortOrder = "last_created" | "first_created";
export interface SessionListParams {
  limit?: number;
  offset?: number;
  search?: string;
  sort_by?: SessionSortOrder;
  signal?: AbortSignal;
}
export type AssetItem = Omit<
  Wire.AssetItem,
  "file_type" | "origin" | "size_bytes" | "prompt"
> & {
  file_type: "image" | "document";
  origin: "upload" | "generated";
  size_bytes: number;
  prompt?: string;
};
export type PaginatedAssetsResponse = Omit<
  Wire.PaginatedAssetsResponse,
  "items"
> & { items: AssetItem[] };
export interface AssetQueryParams {
  userId?: string | null;
  sessionId?: string | null;
  origin?: "upload" | "generated" | "all";
  fileType?: "image" | "document" | "all";
  search?: string;
  limit?: number;
  offset?: number;
}
export type MessageReplyReference = Omit<
  DefinedFields<Wire.MessageReplyReference>,
  "role" | "content"
> & {
  role: "user" | "assistant";
  content: string;
};
export type SessionHistoryResponse = Omit<
  Wire.SessionHistoryResponse,
  "messages" | "documents"
> & {
  messages: Message[];
  documents: DocumentMetadata[];
};

export type User = Wire.UserResponse;
export type Citation = Wire.Citation;
export type DocumentMetadata = Wire.DocumentMetadata;
export type Message = Omit<
  Wire.MessageResponse,
  "role" | "attachments" | "reply_to"
> & {
  role: "user" | "assistant";
  attachments?: MediaAttachment[] | null;
  reply_to?: MessageReplyReference | null;
};

export interface StreamHandlers {
  onMessage?: (message: Wire.MessageAcknowledgement) => void;
  onCitations?: (citations: Citation[]) => void;
  onMedia?: (media: MediaAttachment) => void;
  onToken?: (token: string) => void;
  onError?: (error: string) => void;
  onDone?: () => void;
}

export interface StreamingMessageState {
  id?: string;
  created_at?: string;
  role: "assistant";
  content: string;
  citations?: Citation[] | null;
  attachments?: MediaAttachment[] | null;
  isStreaming: boolean;
  isError: boolean;
}
