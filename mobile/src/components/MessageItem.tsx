import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
  Image,
  Modal,
  Dimensions,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { getAppTheme, type AppTheme } from "../theme/colors";
import type { Citation, MediaAttachment } from "../types";

interface MessageItemProps {
  id?: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[] | null;
  attachments?: MediaAttachment[] | null;
  isStreaming?: boolean;
  onOpenCitations?: (citations: Citation[]) => void;
  onUseAsReference?: (media: MediaAttachment) => void;
  isDark?: boolean;
  theme?: AppTheme;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  role,
  content,
  citations,
  attachments,
  isStreaming = false,
  onOpenCitations,
  onUseAsReference,
  isDark = true,
  theme: customTheme,
}) => {
  const isUser = role === "user";
  const theme = customTheme || getAppTheme(isDark);
  const [copied, setCopied] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const handleCopy = async () => {
    if (!content) return;
    try {
      await Clipboard.setStringAsync(content);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleCitationsPress = () => {
    if (citations && citations.length > 0 && onOpenCitations) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onOpenCitations(citations);
    }
  };

  // Helper to parse inline markdown (**bold**, *italic*, `code`) into styled Text nodes
  const renderInlineSpans = (text: string, baseColor: string) => {
    if (!text) return null;
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
    if (parts.length === 1) {
      return text;
    }

    return parts.map((part, pIdx) => {
      // Bold: **text**
      if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
        return (
          <Text
            key={pIdx}
            style={{
              fontWeight: "700",
              color: baseColor,
            }}
          >
            {part.slice(2, -2)}
          </Text>
        );
      }
      // Italic: *text*
      if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
        return (
          <Text
            key={pIdx}
            style={{
              fontStyle: "italic",
              color: baseColor,
            }}
          >
            {part.slice(1, -1)}
          </Text>
        );
      }
      // Inline code: `code`
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
        return (
          <Text
            key={pIdx}
            style={[
              styles.inlineCode,
              {
                backgroundColor: isUser
                  ? "rgba(255, 255, 255, 0.2)"
                  : theme.borderSubtle,
                color: isUser ? "#ffffff" : theme.primary,
              },
            ]}
          >
            {part.slice(1, -1)}
          </Text>
        );
      }
      return part;
    });
  };

  // Helper to format basic markdown blocks cleanly for native display
  const renderFormattedContent = (text: string) => {
    if (!text || !text.trim()) return null;
    const lines = text.split("\n");

    return lines.map((line, idx) => {
      const trimmed = line.trim();
      const textColor = isUser ? "#ffffff" : theme.textMain;

      // Heading 3 / 2 / 1
      if (line.startsWith("### ")) {
        return (
          <Text key={idx} style={[styles.heading3, { color: theme.textMain }]}>
            {renderInlineSpans(line.substring(4), theme.textMain)}
          </Text>
        );
      }
      if (line.startsWith("## ") || line.startsWith("# ")) {
        return (
          <Text key={idx} style={[styles.heading2, { color: theme.textMain }]}>
            {renderInlineSpans(line.replace(/^#+\s*/, ""), theme.textMain)}
          </Text>
        );
      }

      // Bullet points
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        return (
          <View key={idx} style={styles.bulletRow}>
            <View
              style={[styles.bulletDot, { backgroundColor: theme.primary }]}
            />
            <Text style={[styles.bulletText, { color: textColor }]}>
              {renderInlineSpans(trimmed.substring(2), textColor)}
            </Text>
          </View>
        );
      }

      // Numbered list
      const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
      if (numMatch) {
        return (
          <View key={idx} style={styles.bulletRow}>
            <Text style={[styles.numberPrefix, { color: theme.primary }]}>
              {numMatch[1]}.
            </Text>
            <Text style={[styles.bulletText, { color: textColor }]}>
              {renderInlineSpans(numMatch[2], textColor)}
            </Text>
          </View>
        );
      }

      // Empty line / spacer
      if (!trimmed) {
        return <View key={idx} style={{ height: 6 }} />;
      }

      // Standard text line with bold parsing
      return (
        <Text key={idx} style={[styles.messageText, { color: textColor }]}>
          {renderInlineSpans(line, textColor)}
        </Text>
      );
    });
  };

  return (
    <View
      style={[
        styles.container,
        isUser ? styles.userContainer : styles.assistantContainer,
      ]}
    >
      {/* Attached Media Previews */}
      {attachments && attachments.length > 0 && (
        <View
          style={[
            styles.mediaContainer,
            isUser ? styles.userMediaContainer : styles.assistantMediaContainer,
          ]}
        >
          {attachments.map((att, attIdx) => (
            <TouchableOpacity
              key={att.id || attIdx}
              onPress={() => setPreviewImageUrl(att.url)}
              activeOpacity={0.85}
              style={[
                styles.mediaCard,
                { borderColor: theme.borderSubtle, backgroundColor: theme.bgCard },
              ]}
            >
              <Image
                source={{ uri: att.url }}
                style={styles.mediaImage}
                resizeMode="cover"
              />
              {!isUser && onUseAsReference && (
                <TouchableOpacity
                  style={[styles.refBtn, { backgroundColor: theme.primary }]}
                  onPress={() => onUseAsReference(att)}
                >
                  <Ionicons name="sparkles" size={11} color="#FFF" />
                  <Text style={styles.refBtnText}>Remix</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Pressable
        onLongPress={handleCopy}
        delayLongPress={350}
        style={[
          styles.bubble,
          isUser
            ? [styles.userBubble, { backgroundColor: theme.userBubble }]
            : [
                styles.assistantBubble,
                {
                  backgroundColor: theme.aiBubble,
                  borderColor: theme.borderSubtle,
                },
              ],
        ]}
      >
        {isStreaming && !content?.trim() ? (
          <View style={styles.thinkingRow}>
            <View
              style={[styles.pulseDot, { backgroundColor: theme.primary }]}
            />
            <Text style={[styles.thinkingText, { color: theme.textMuted }]}>
              Thinking...
            </Text>
          </View>
        ) : (
          renderFormattedContent(content)
        )}
      </Pressable>

      {/* Action Toolbar for User message */}
      {isUser && content.length > 0 && (
        <View style={[styles.toolbarRow, styles.userToolbarRow]}>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              {
                backgroundColor: copied ? theme.emeraldLight : theme.bgCard,
                borderColor: copied ? theme.emeraldBorder : theme.borderSubtle,
              },
            ]}
            onPress={handleCopy}
            activeOpacity={0.7}
          >
            <Feather
              name={copied ? "check" : "copy"}
              size={13}
              color={copied ? theme.emerald : theme.textMuted}
            />
          </TouchableOpacity>
        </View>
      )}

      {/* Action Toolbar for AI message */}
      {!isUser && content.length > 0 && !isStreaming && (
        <View style={styles.toolbarRow}>
          {/* Copy Button */}
          <TouchableOpacity
            style={[
              styles.actionBtn,
              {
                backgroundColor: copied ? theme.emeraldLight : theme.bgCard,
                borderColor: copied ? theme.emeraldBorder : theme.borderSubtle,
              },
            ]}
            onPress={handleCopy}
            activeOpacity={0.7}
          >
            <Feather
              name={copied ? "check" : "copy"}
              size={13}
              color={copied ? theme.emerald : theme.textMuted}
            />
          </TouchableOpacity>

          {/* Perplexity Citations Pill Button */}
          {citations && citations.length > 0 && (
            <TouchableOpacity
              style={[
                styles.citationPill,
                {
                  backgroundColor: theme.primaryLight,
                  borderColor: theme.primaryBorder,
                },
              ]}
              onPress={handleCitationsPress}
              activeOpacity={0.7}
            >
              <Ionicons name="layers-outline" size={12} color={theme.primary} />
              <Text style={[styles.citationPillText, { color: theme.primary }]}>
                {citations.length}{" "}
                {citations.length === 1 ? "source" : "sources"}
              </Text>
              <Feather name="chevron-right" size={11} color={theme.primary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Fullscreen Image Preview Modal */}
      {previewImageUrl && (
        <Modal
          visible={!!previewImageUrl}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setPreviewImageUrl(null)}
        >
          <View style={styles.modalBackdrop}>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setPreviewImageUrl(null)}
            >
              <Feather name="x" size={24} color="#FFF" />
            </TouchableOpacity>
            <Image
              source={{ uri: previewImageUrl }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          </View>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 5,
    paddingHorizontal: 12,
    width: "100%",
  },
  userContainer: {
    alignItems: "flex-end",
  },
  assistantContainer: {
    alignItems: "flex-start",
  },
  mediaContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 6,
    maxWidth: "88%",
  },
  userMediaContainer: {
    justifyContent: "flex-end",
  },
  assistantMediaContainer: {
    justifyContent: "flex-start",
  },
  mediaCard: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    position: "relative",
  },
  mediaImage: {
    width: 200,
    height: 180,
    borderRadius: 13,
  },
  refBtn: {
    position: "absolute",
    bottom: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  refBtnText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCloseBtn: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  modalImage: {
    width: "92%",
    height: "80%",
  },
  bubble: {
    maxWidth: "88%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
  },
  userBubble: {
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    borderBottomLeftRadius: 4,
    borderWidth: 1,
  },
  messageText: {
    fontSize: 16.5,
    lineHeight: 25,
    letterSpacing: 0.1,
  },
  heading2: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 4,
  },
  heading3: {
    fontSize: 17.5,
    lineHeight: 23,
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 3,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginVertical: 2,
    paddingLeft: 4,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 9.5,
  },
  numberPrefix: {
    fontSize: 16,
    fontWeight: "700",
    marginRight: 6,
    minWidth: 18,
    lineHeight: 25,
  },
  bulletText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    marginLeft: 10,
  },
  boldText: {
    fontWeight: "700",
  },
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  thinkingText: {
    fontSize: 14,
    fontWeight: "500",
  },
  toolbarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  userToolbarRow: {
    justifyContent: "flex-end",
    alignSelf: "flex-end",
    paddingRight: 4,
  },
  actionBtn: {
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
  },
  citationPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 5.5,
    borderRadius: 8,
    borderWidth: 1,
  },
  citationPillText: {
    fontSize: 13,
    fontWeight: "700",
  },
  inlineCode: {
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
    fontSize: 14,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
});
