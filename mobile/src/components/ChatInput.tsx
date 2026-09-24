import React, { useState, useEffect } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import { getAppTheme, type AppTheme } from "../theme/colors";
import type { DocumentMetadata, ChatMode, MediaAttachment } from "../types";
import { Image } from "react-native";

interface ChatInputProps {
  query: string;
  onChangeQuery: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  isSending: boolean;
  onAttachFile: (file: { uri: string; name: string; mimeType: string }) => void;
  isUploading: boolean;
  documents: DocumentMetadata[];
  onDeleteDocument: (docId: string) => void;
  attachedMedia?: MediaAttachment[];
  onDeleteMedia?: (index: number) => void;
  currentMode: ChatMode;
  onToggleMode?: () => void;
  isDark?: boolean;
  theme?: AppTheme;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  query,
  onChangeQuery,
  onSend,
  onStop,
  isSending,
  onAttachFile,
  isUploading,
  documents,
  onDeleteDocument,
  attachedMedia = [],
  onDeleteMedia,
  currentMode,
  onToggleMode,
  isDark = true,
  theme: customTheme,
}) => {
  const theme = customTheme || getAppTheme(isDark);
  const isAuto = currentMode === "AUTO";
  const isWeb = currentMode === "WEB_SEARCH";
  const isDraw = currentMode === "IMAGE_GENERATION";
  const isVision = currentMode === "MULTIMODAL";
  const isDoc = currentMode === "DOCUMENT_RAG";
  const canSend = (query.trim().length > 0 || attachedMedia.length > 0) && !isSending;
  const insets = useSafeAreaInsets();
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleContentSizeChange = (e: {
    nativeEvent: { contentSize: { height: number } };
  }) => {
    const height = e.nativeEvent.contentSize.height;
    if (height > 36 || query.includes("\n")) {
      if (!isExpanded) setIsExpanded(true);
    }
  };

  const handleTextChange = (text: string) => {
    onChangeQuery(text);
    if (!text.trim() || (!text.includes("\n") && text.trim().length < 15)) {
      if (isExpanded) setIsExpanded(false);
    }
  };

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () =>
      setIsKeyboardOpen(true),
    );
    const hideSub = Keyboard.addListener(hideEvent, () =>
      setIsKeyboardOpen(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handlePickDocument = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "image/*",
          "application/pdf",
          "text/plain",
          "text/markdown",
          "text/csv",
          "application/json",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
        copyToCacheDirectory: true,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const file = res.assets[0];
        onAttachFile({
          uri: file.uri,
          name: file.name,
          mimeType: file.mimeType || "application/octet-stream",
        });
      }
    } catch (err) {
      console.warn("Document picker cancelled or failed:", err);
    }
  };

  const handleSendPress = () => {
    if (canSend) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setIsExpanded(false);
      onSend();
    }
  };

  const handleStopPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    onStop();
  };

  const renderAttachButton = () => (
    <TouchableOpacity
      style={[styles.attachButton, { backgroundColor: theme.borderSubtle }]}
      onPress={handlePickDocument}
      disabled={isUploading}
      activeOpacity={0.7}
    >
      {isUploading ? (
        <ActivityIndicator size={14} color={theme.primary} />
      ) : (
        <Feather name="plus" size={18} color={theme.textMain} />
      )}
    </TouchableOpacity>
  );

  const getModeDetails = () => {
    if (isAuto) return { icon: "sparkles", label: "Auto", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.14)", border: "rgba(245, 158, 11, 0.3)" };
    if (isWeb) return { icon: "globe-outline", label: "Web", color: theme.emerald, bg: theme.emeraldLight, border: theme.emeraldBorder };
    if (isDraw) return { icon: "color-palette-outline", label: "Draw", color: "#ec4899", bg: "rgba(236, 72, 153, 0.14)", border: "rgba(236, 72, 153, 0.3)" };
    if (isVision) return { icon: "eye-outline", label: "Vision", color: "#8b5cf6", bg: "rgba(139, 92, 246, 0.14)", border: "rgba(139, 92, 246, 0.3)" };
    return { icon: "document-text-outline", label: "Doc", color: theme.primary, bg: theme.primaryLight, border: theme.primaryBorder };
  };

  const modeDetails = getModeDetails();

  const renderRightActions = () => (
    <View style={styles.rightActions}>
      {onToggleMode && (
        <TouchableOpacity
          style={[
            styles.modeChip,
            {
              backgroundColor: modeDetails.bg,
              borderColor: modeDetails.border,
            },
          ]}
          onPress={() => {
            Haptics.selectionAsync();
            onToggleMode();
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name={modeDetails.icon as any}
            size={12}
            color={modeDetails.color}
          />
          <Text
            style={[
              styles.modeChipText,
              { color: modeDetails.color },
            ]}
          >
            {modeDetails.label}
          </Text>
        </TouchableOpacity>
      )}

      {/* Action: Send or Stop Button */}
      {isSending ? (
        <TouchableOpacity
          style={[styles.stopButton, { backgroundColor: theme.danger }]}
          onPress={handleStopPress}
          activeOpacity={0.8}
        >
          <View style={styles.stopSquare} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[
            styles.sendButton,
            {
              backgroundColor: canSend ? theme.primary : theme.borderSubtle,
              opacity: canSend ? 1 : 0.4,
            },
          ]}
          onPress={handleSendPress}
          disabled={!canSend}
          activeOpacity={0.8}
        >
          <Feather
            name="arrow-up"
            size={18}
            color={canSend ? "#ffffff" : theme.textMuted}
          />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View
      style={[
        styles.outerContainer,
        {
          backgroundColor: theme.bgApp,
          paddingBottom: isKeyboardOpen
            ? Platform.OS === "ios"
              ? 12
              : 16
            : Math.max(insets.bottom + 8, 18),
        },
      ]}
    >
      {/* Attached Documents & Media Row */}
      {(documents.length > 0 || attachedMedia.length > 0 || isUploading) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.attachmentScroll}
        >
          {isUploading && (
            <View
              style={[
                styles.uploadingChip,
                {
                  backgroundColor: theme.primaryLight,
                  borderColor: theme.primaryBorder,
                },
              ]}
            >
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={[styles.chipText, { color: theme.primary }]}>
                Uploading & processing...
              </Text>
            </View>
          )}

          {/* Image / Media Attachments */}
          {attachedMedia.map((media, idx) => (
            <View
              key={media.url || `media_${idx}`}
              style={[
                styles.mediaChip,
                {
                  backgroundColor: theme.bgInput,
                  borderColor: theme.borderSubtle,
                },
              ]}
            >
              {media.url ? (
                <Image
                  source={{ uri: media.url }}
                  style={styles.mediaThumb}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="image-outline" size={14} color={theme.primary} />
              )}
              <Text
                style={[styles.chipText, { color: theme.textMain }]}
                numberOfLines={1}
              >
                {media.file_name || `Image ${idx + 1}`}
              </Text>
              {onDeleteMedia && (
                <TouchableOpacity
                  onPress={() => onDeleteMedia(idx)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="x" size={12} color={theme.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          {/* Documents */}
          {documents.map((doc) => (
            <View
              key={doc.document_id}
              style={[
                styles.docChip,
                {
                  backgroundColor: theme.bgInput,
                  borderColor: theme.borderSubtle,
                },
              ]}
            >
              <Feather name="file-text" size={12} color={theme.primary} />
              <Text
                style={[styles.chipText, { color: theme.textMain }]}
                numberOfLines={1}
              >
                {doc.filename}
              </Text>
              <TouchableOpacity
                onPress={() => onDeleteDocument(doc.document_id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={12} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Main Input Container (Pill when closed, Card when open) */}
      <View
        style={[
          isExpanded ? styles.cardContainer : styles.pillContainer,
          {
            backgroundColor: theme.bgInput,
            borderColor: theme.borderSubtle,
          },
        ]}
      >
        {/* If Collapsed: Attach Button on Left */}
        {!isExpanded && renderAttachButton()}

        {/* Text Input */}
        <TextInput
          style={[
            isExpanded ? styles.textInputExpanded : styles.textInputCollapsed,
            {
              color: theme.textMain,
            },
          ]}
          placeholder={
            isDraw
              ? "Describe image to generate or remix..."
              : isVision
              ? "Ask about image, or extract tables/text..."
              : isDoc
              ? "Ask questions about documents..."
              : isWeb
              ? "Search live web..."
              : "Ask anything, attach files, or generate images..."
          }
          placeholderTextColor={theme.textMuted}
          multiline
          value={query}
          onChangeText={handleTextChange}
          onContentSizeChange={handleContentSizeChange}
          maxLength={4000}
        />

        {/* If Collapsed: Right Actions */}
        {!isExpanded && renderRightActions()}

        {/* If Expanded: Bottom Actions Row */}
        {isExpanded && (
          <View style={styles.bottomBar}>
            {renderAttachButton()}
            {renderRightActions()}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  attachmentScroll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 8,
  },
  uploadingChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  mediaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 180,
  },
  mediaThumb: {
    width: 22,
    height: 22,
    borderRadius: 6,
  },
  docChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 160,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  pillContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 50,
    gap: 6,
  },
  cardContainer: {
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
  },
  textInputCollapsed: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 40,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  textInputExpanded: {
    width: "100%",
    fontSize: 16,
    lineHeight: 22,
    minHeight: 38,
    maxHeight: 120,
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 4,
    textAlignVertical: "top",
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 4,
  },
  rightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  attachButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  modeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5.5,
    borderRadius: 12,
    borderWidth: 1,
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: "700",
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  stopButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  stopSquare: {
    width: 12,
    height: 12,
    backgroundColor: "#ffffff",
    borderRadius: 2,
  },
});
