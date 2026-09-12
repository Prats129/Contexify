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
import type { DocumentMetadata, ChatMode } from "../types";

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
  currentMode,
  onToggleMode,
  isDark = true,
  theme: customTheme,
}) => {
  const theme = customTheme || getAppTheme(isDark);
  const isWeb = currentMode === "WEB_SEARCH";
  const canSend = query.trim().length > 0 && !isSending;
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

  const renderRightActions = () => (
    <View style={styles.rightActions}>
      {onToggleMode && (
        <TouchableOpacity
          style={[
            styles.modeChip,
            {
              backgroundColor: isWeb ? theme.emeraldLight : theme.primaryLight,
              borderColor: isWeb ? theme.emeraldBorder : theme.primaryBorder,
            },
          ]}
          onPress={() => {
            Haptics.selectionAsync();
            onToggleMode();
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name={isWeb ? "globe-outline" : "document-text-outline"}
            size={12}
            color={isWeb ? theme.emerald : theme.primary}
          />
          <Text
            style={[
              styles.modeChipText,
              { color: isWeb ? theme.emerald : theme.primary },
            ]}
          >
            {isWeb ? "Web" : "Doc"}
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
      {/* Attached Documents Row */}
      {(documents.length > 0 || isUploading) && (
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
                Vectorizing file...
              </Text>
            </View>
          )}

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
            currentMode === "WEB_SEARCH"
              ? "Ask anything"
              : "Ask questions about documents"
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
