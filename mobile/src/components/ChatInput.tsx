import React from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import { getAppTheme, type AppTheme } from '../theme/colors';
import type { DocumentMetadata, ChatMode } from '../types';

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
  const isWeb = currentMode === 'WEB_SEARCH';
  const canSend = query.trim().length > 0 && !isSending;

  const handlePickDocument = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'text/plain',
          'text/markdown',
          'text/csv',
          'application/json',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
        copyToCacheDirectory: true,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const file = res.assets[0];
        onAttachFile({
          uri: file.uri,
          name: file.name,
          mimeType: file.mimeType || 'application/octet-stream',
        });
      }
    } catch (err) {
      console.warn('Document picker cancelled or failed:', err);
    }
  };

  const handleSendPress = () => {
    if (canSend) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onSend();
    }
  };

  const handleStopPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    onStop();
  };

  return (
    <View style={[styles.outerContainer, { backgroundColor: theme.bgApp }]}>
      {/* Attached Documents Row */}
      {(documents.length > 0 || isUploading) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.attachmentScroll}
        >
          {isUploading && (
            <View style={[styles.uploadingChip, { backgroundColor: theme.primaryLight, borderColor: theme.primaryBorder }]}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={[styles.chipText, { color: theme.primary }]}>Vectorizing file...</Text>
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
              <Text style={[styles.chipText, { color: theme.textMain }]} numberOfLines={1}>
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

      {/* Main Input Pill Bar */}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: theme.bgInput,
            borderColor: theme.borderSubtle,
          },
        ]}
      >
        {/* Plus Attach File Button */}
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

        {/* Mode Switcher Pill */}
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
              name={isWeb ? 'globe-outline' : 'document-text-outline'}
              size={12}
              color={isWeb ? theme.emerald : theme.primary}
            />
            <Text
              style={[
                styles.modeChipText,
                { color: isWeb ? theme.emerald : theme.primary },
              ]}
            >
              {isWeb ? 'Web' : 'Doc'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Text Input */}
        <TextInput
          style={[
            styles.textInput,
            {
              color: theme.textMain,
            },
          ]}
          placeholder={
            currentMode === 'WEB_SEARCH'
              ? 'Search the web with Gemini...'
              : 'Ask questions about documents...'
          }
          placeholderTextColor={theme.textMuted}
          multiline
          value={query}
          onChangeText={onChangeQuery}
          maxLength={4000}
        />

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
              color={canSend ? '#ffffff' : theme.textMuted}
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
  },
  attachmentScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
  },
  uploadingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  docChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 160,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 50,
    gap: 6,
  },
  attachButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5.5,
    borderRadius: 12,
    borderWidth: 1,
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 110,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquare: {
    width: 12,
    height: 12,
    backgroundColor: '#ffffff',
    borderRadius: 2,
  },
});
