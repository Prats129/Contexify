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
  media_id?: string;
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

export type User = Omit<Wire.UserResponse, "created_at"> & {
  created_at?: string;
  is_verified?: boolean;
};
export type Citation = Partial<Wire.Citation> &
  Pick<Wire.Citation, "snippet"> & { source_id?: number | string };
export type DocumentMetadata = Wire.DocumentMetadata & { session_id?: string };
export type Message = Omit<
  Wire.MessageResponse,
  | "role"
  | "session_id"
  | "created_at"
  | "citations"
  | "attachments"
  | "reply_to"
> & {
  role: "user" | "assistant";
  session_id?: string;
  created_at?: string;
  citations?: Citation[] | null;
  attachments?: MediaAttachment[] | null;
  reply_to?: MessageReplyReference | null;
};

export interface StreamingMessageState {
  id?: string;
  created_at?: string;
  content: string;
  citations: Citation[];
  attachments?: MediaAttachment[];
}

export interface StreamHandlers {
  onMessage?: (message: Wire.MessageAcknowledgement) => void;
  onToken: (token: string) => void;
  onCitations: (citations: Citation[]) => void;
  onMedia?: (media: MediaAttachment) => void;
  onError: (error: string) => void;
  onComplete: () => void;
}
