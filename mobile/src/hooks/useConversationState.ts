import { useState, useRef, useCallback, useSyncExternalStore } from "react";
import { ConversationStore } from "../services/conversation_store";
import type {
  ChatMode,
  DocumentMetadata,
  MediaAttachment,
  Message,
  MessageReplyReference,
  StreamingMessageState,
} from "../types";

export function useConversationState() {
  const [conversationStore] = useState(
    () =>
      new ConversationStore(
        () => ({
          isTemporaryChat: false,
          currentMode: "AUTO" as ChatMode,
          documents: [] as DocumentMetadata[],
          pendingDocumentIds: [] as string[],
          attachedMedia: [] as MediaAttachment[],
          messages: [] as Message[],
          replyingTo: null as MessageReplyReference | null,
          isSending: false,
          isClearingHistory: false,
          streamingMessage: null as StreamingMessageState | null,
          isUploading: false,
          isLoadingHistory: false,
          historyLoadingDirection: null as
            | "older"
            | "newer"
            | "latest"
            | "target"
            | null,
          historyLatestRevision: 0,
          hasOlderHistory: false,
          hasNewerHistory: false,
          historyError: null as string | null,
          operationError: null as string | null,
          query: "",
        }),
        (entry) =>
          !entry.state.isSending &&
          !entry.state.isUploading &&
          !entry.state.isLoadingHistory &&
          !entry.state.isClearingHistory &&
          !entry.state.query &&
          !entry.state.replyingTo &&
          !entry.state.attachedMedia.length &&
          !entry.state.pendingDocumentIds.length &&
          !entry.state.operationError,
      ),
  );
  useSyncExternalStore(
    conversationStore.subscribe,
    conversationStore.getSnapshot,
    conversationStore.getSnapshot,
  );
  const conversation = conversationStore.active;
  const activeSessionId = conversation.sessionId;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const setActiveSessionId = useCallback(
    (sessionId: string | null) => {
      conversationStore.select(sessionId);
      activeSessionIdRef.current = sessionId;
    },
    [conversationStore],
  );
  const {
    isTemporaryChat,
    currentMode,
    documents,
    pendingDocumentIds,
    attachedMedia,
    messages,
    replyingTo,
    isSending,
    streamingMessage,
    isUploading,
    query,
    operationError,
    isLoadingHistory,
    historyLoadingDirection,
    historyError,
  } = conversation.state;
  const setIsTemporaryChat = conversationStore.setter(
    conversation,
    "isTemporaryChat",
  );
  const setCurrentMode = conversationStore.setter(conversation, "currentMode");
  const setDocuments = conversationStore.setter(conversation, "documents");
  const setPendingDocumentIds = conversationStore.setter(
    conversation,
    "pendingDocumentIds",
  );
  const setAttachedMedia = conversationStore.setter(
    conversation,
    "attachedMedia",
  );
  const setMessages = conversationStore.setter(conversation, "messages");
  const setReplyingTo = conversationStore.setter(conversation, "replyingTo");
  const setIsSending = conversationStore.setter(conversation, "isSending");
  const setStreamingMessage = conversationStore.setter(
    conversation,
    "streamingMessage",
  );
  const setIsUploading = conversationStore.setter(conversation, "isUploading");
  const setOperationError = conversationStore.setter(
    conversation,
    "operationError",
  );
  const setQuery = conversationStore.setter(conversation, "query");

  return {
    conversationStore,
    conversation,
    activeSessionId,
    activeSessionIdRef,
    setActiveSessionId,
    isTemporaryChat,
    currentMode,
    documents,
    pendingDocumentIds,
    attachedMedia,
    messages,
    replyingTo,
    isSending,
    streamingMessage,
    isUploading,
    query,
    operationError,
    isLoadingHistory,
    historyLoadingDirection,
    historyError,
    setIsTemporaryChat,
    setCurrentMode,
    setDocuments,
    setPendingDocumentIds,
    setAttachedMedia,
    setMessages,
    setReplyingTo,
    setIsSending,
    setStreamingMessage,
    setIsUploading,
    setOperationError,
    setQuery,
  };
}
