import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Linking,
  Pressable,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme/colors';
import type { Citation } from '../types';

interface CitationsSheetProps {
  visible: boolean;
  citations: Citation[];
  onClose: () => void;
  isDark?: boolean;
}

function parseCitation(c: Citation): { title: string; url: string; domain: string; snippet: string } {
  let url = '';
  let domain = '';
  let snippet = c.snippet || '';

  const lines = snippet.split('\n');
  if (lines[0].startsWith('http://') || lines[0].startsWith('https://')) {
    url = lines[0].trim();
    snippet = lines.slice(1).join(' ').trim();
  } else if (c.document_id && (c.document_id.startsWith('http://') || c.document_id.startsWith('https://'))) {
    url = c.document_id;
  }

  if (url) {
    try {
      const match = url.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
      domain = match ? match[1].replace(/^www\./, '') : 'web';
    } catch {
      domain = 'web';
    }
  }

  const title = c.filename || domain || 'Source';
  return { title, url, domain, snippet };
}

export const CitationsSheet: React.FC<CitationsSheetProps> = ({
  visible,
  citations,
  onClose,
  isDark = true,
}) => {
  const theme = isDark ? colors.dark : colors.light;

  const handleOpenLink = (url: string) => {
    if (!url) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(url).catch(() => {});
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheetContainer,
            {
              backgroundColor: theme.bgCard,
              borderColor: theme.borderHover,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Pull Handle */}
          <View style={styles.handleRow}>
            <View style={[styles.handleBar, { backgroundColor: theme.textMuted }]} />
          </View>

          {/* Header */}
          <View style={[styles.headerRow, { borderBottomColor: theme.borderSubtle }]}>
            <View style={styles.titleRow}>
              <Ionicons name="layers-outline" size={18} color={colors.primary} />
              <Text style={[styles.sheetTitle, { color: theme.textMain }]}>Sources & Grounding</Text>
              <View style={[styles.badge, { backgroundColor: colors.primaryLight }]}>
                <Text style={[styles.badgeText, { color: colors.primary }]}>{citations.length}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: theme.borderSubtle }]}
              onPress={onClose}
            >
              <Feather name="x" size={16} color={theme.textMain} />
            </TouchableOpacity>
          </View>

          {/* Citations List */}
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {citations.map((c, idx) => {
              const { title, url, domain, snippet } = parseCitation(c);
              const isWeb = Boolean(url || domain);

              return (
                <View
                  key={idx}
                  style={[
                    styles.card,
                    {
                      backgroundColor: theme.bgInput,
                      borderColor: theme.borderSubtle,
                    },
                  ]}
                >
                  {/* Source metadata row */}
                  <View style={styles.cardMetaRow}>
                    <View style={styles.metaLeft}>
                      <Ionicons
                        name={isWeb ? 'globe-outline' : 'document-text-outline'}
                        size={13}
                        color={isWeb ? colors.emerald : colors.primary}
                      />
                      <Text style={[styles.domainText, { color: theme.textMuted }]}>
                        {domain || c.filename || 'Document'}
                      </Text>
                    </View>

                    {!isWeb && c.page_number && (
                      <View style={[styles.pagePill, { backgroundColor: theme.borderSubtle }]}>
                        <Text style={[styles.pagePillText, { color: theme.textMuted }]}>
                          p. {c.page_number}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Title / Clickable link */}
                  {url ? (
                    <TouchableOpacity
                      onPress={() => handleOpenLink(url)}
                      activeOpacity={0.7}
                      style={styles.linkRow}
                    >
                      <Text style={[styles.cardTitle, { color: colors.primary }]} numberOfLines={2}>
                        {title}
                      </Text>
                      <Feather name="external-link" size={12} color={colors.primary} />
                    </TouchableOpacity>
                  ) : (
                    <Text style={[styles.cardTitle, { color: theme.textMain }]} numberOfLines={2}>
                      {title}
                    </Text>
                  )}

                  {/* Snippet excerpt */}
                  {snippet ? (
                    <Text style={[styles.snippetText, { color: theme.textMuted }]} numberOfLines={4}>
                      {snippet}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    maxHeight: '80%',
    minHeight: 280,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    paddingBottom: 24,
  },
  handleRow: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  handleBar: {
    width: 38,
    height: 4,
    borderRadius: 2,
    opacity: 0.3,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: 16,
  },
  listContent: {
    paddingVertical: 12,
    gap: 10,
  },
  card: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  domainText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'lowercase',
  },
  pagePill: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  pagePillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
    flex: 1,
  },
  snippetText: {
    fontSize: 12,
    lineHeight: 18,
  },
});
