import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Clipboard } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { getAppTheme, type AppTheme } from '../theme/colors';
import type { Citation } from '../types';

interface MessageItemProps {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[] | null;
  isStreaming?: boolean;
  onOpenCitations?: (citations: Citation[]) => void;
  isDark?: boolean;
  theme?: AppTheme;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  role,
  content,
  citations,
  isStreaming = false,
  onOpenCitations,
  isDark = true,
  theme: customTheme,
}) => {
  const isUser = role === 'user';
  const theme = customTheme || getAppTheme(isDark);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!content) return;
    Clipboard.setString(content);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCitationsPress = () => {
    if (citations && citations.length > 0 && onOpenCitations) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onOpenCitations(citations);
    }
  };

  // Helper to format basic markdown blocks cleanly for native display
  const renderFormattedContent = (text: string) => {
    if (!text || !text.trim()) return null;
    const lines = text.split('\n');

    return lines.map((line, idx) => {
      const trimmed = line.trim();

      // Heading 3 / 2 / 1
      if (line.startsWith('### ')) {
        return (
          <Text key={idx} style={[styles.heading3, { color: theme.textMain }]}>
            {line.substring(4)}
          </Text>
        );
      }
      if (line.startsWith('## ') || line.startsWith('# ')) {
        return (
          <Text key={idx} style={[styles.heading2, { color: theme.textMain }]}>
            {line.replace(/^#+\s*/, '')}
          </Text>
        );
      }

      // Bullet points
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        return (
          <View key={idx} style={styles.bulletRow}>
            <View style={[styles.bulletDot, { backgroundColor: theme.primary }]} />
            <Text style={[styles.bulletText, { color: isUser ? '#ffffff' : theme.textMain }]}>
              {trimmed.substring(2)}
            </Text>
          </View>
        );
      }

      // Numbered list
      const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
      if (numMatch) {
        return (
          <View key={idx} style={styles.bulletRow}>
            <Text style={[styles.numberPrefix, { color: theme.primary }]}>{numMatch[1]}.</Text>
            <Text style={[styles.bulletText, { color: isUser ? '#ffffff' : theme.textMain }]}>
              {numMatch[2]}
            </Text>
          </View>
        );
      }

      // Empty line / spacer
      if (!trimmed) {
        return <View key={idx} style={{ height: 6 }} />;
      }

      // Standard text line
      return (
        <Text
          key={idx}
          style={[
            styles.messageText,
            { color: isUser ? '#ffffff' : theme.textMain },
          ]}
        >
          {line}
        </Text>
      );
    });
  };

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      <View
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
            <View style={[styles.pulseDot, { backgroundColor: theme.primary }]} />
            <Text style={[styles.thinkingText, { color: theme.textMuted }]}>Thinking...</Text>
          </View>
        ) : (
          renderFormattedContent(content)
        )}
      </View>

      {/* Action Toolbar for AI message */}
      {!isUser && content.length > 0 && !isStreaming && (
        <View style={styles.toolbarRow}>
          {/* Copy Button */}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.borderSubtle }]}
            onPress={handleCopy}
            activeOpacity={0.7}
          >
            <Feather
              name={copied ? 'check' : 'copy'}
              size={12}
              color={copied ? theme.emerald : theme.textMuted}
            />
            <Text
              style={[
                styles.actionBtnText,
                { color: copied ? theme.emerald : theme.textMuted },
              ]}
            >
              {copied ? 'Copied' : 'Copy'}
            </Text>
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
                {citations.length} {citations.length === 1 ? 'source' : 'sources'}
              </Text>
              <Feather name="chevron-right" size={11} color={theme.primary} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 5,
    paddingHorizontal: 12,
    width: '100%',
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  assistantContainer: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '88%',
    paddingHorizontal: 14,
    paddingVertical: 10,
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
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0.1,
  },
  heading2: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 4,
  },
  heading3: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 2,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 2,
    paddingLeft: 4,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 8,
    marginRight: 8,
  },
  numberPrefix: {
    fontSize: 14,
    fontWeight: '700',
    marginRight: 6,
    minWidth: 16,
  },
  bulletText: {
    fontSize: 15,
    lineHeight: 21,
    flex: 1,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  thinkingText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '88%',
    marginTop: 4,
    paddingHorizontal: 4,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  citationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  citationPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
