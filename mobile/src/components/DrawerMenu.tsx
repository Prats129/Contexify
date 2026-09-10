import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme/colors';
import type { ChatSession, DocumentMetadata, User } from '../types';

interface DrawerMenuProps {
  visible: boolean;
  onClose: () => void;
  currentUser: User | null;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewChat: () => void;
  documents: DocumentMetadata[];
  onDeleteDocument: (id: string) => void;
  onOpenAuth: () => void;
  onOpenServerConfig: () => void;
  onLogout: () => void;
  isDark?: boolean;
}

export const DrawerMenu: React.FC<DrawerMenuProps> = ({
  visible,
  onClose,
  currentUser,
  sessions = [],
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onNewChat,
  documents = [],
  onDeleteDocument,
  onOpenAuth,
  onOpenServerConfig,
  onLogout,
  isDark = true,
}) => {
  const theme = isDark ? colors.dark : colors.light;
  const sessionList = Array.isArray(sessions) ? sessions : [];
  const docList = Array.isArray(documents) ? documents : [];

  const handleSelect = (id: string) => {
    Haptics.selectionAsync();
    onSelectSession(id);
    onClose();
  };

  const handleDeletePress = (id: string, title: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      'Delete Conversation?',
      `Are you sure you want to delete "${title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDeleteSession(id),
        },
      ]
    );
  };

  const handleLogoutPress = () => {
    Alert.alert('Log out?', 'Are you sure you want to log out of your account?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: onLogout },
    ]);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        {/* Drawer Slide-in Container */}
        <View
          style={[
            styles.drawer,
            {
              backgroundColor: theme.bgSidebar,
              borderRightColor: theme.borderSubtle,
            },
          ]}
        >
          {/* Brand Header */}
          <View style={[styles.brandRow, { borderBottomColor: theme.borderSubtle }]}>
            <View style={styles.brandLeft}>
              <View style={[styles.logoIcon, { backgroundColor: colors.primary }]}>
                <Ionicons name="sparkles" size={15} color="#ffffff" />
              </View>
              <View>
                <Text style={[styles.brandTitle, { color: theme.textMain }]}>Contexify AI</Text>
                <Text style={[styles.brandSubtitle, { color: theme.textMuted }]}>Enterprise RAG & Search</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: theme.borderSubtle }]}
              onPress={onClose}
            >
              <Feather name="x" size={16} color={theme.textMain} />
            </TouchableOpacity>
          </View>

          {/* New Chat Button */}
          <TouchableOpacity
            style={[styles.newChatBtn, { backgroundColor: colors.primary }]}
            onPress={() => {
              onNewChat();
              onClose();
            }}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={16} color="#ffffff" />
            <Text style={styles.newChatText}>New Conversation</Text>
          </TouchableOpacity>

          {/* Scrollable Content */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* User or Guest Account Card */}
            {currentUser ? (
              <View
                style={[
                  styles.profileCard,
                  {
                    backgroundColor: theme.bgInput,
                    borderColor: theme.borderSubtle,
                  },
                ]}
              >
                <View style={styles.profileInfo}>
                  <View
                    style={[
                      styles.profileAvatar,
                      {
                        backgroundColor: currentUser.avatar_color || colors.primary,
                      },
                    ]}
                  >
                    <Text style={styles.profileAvatarText}>
                      {(currentUser.display_name || currentUser.username || 'U').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.profileName, { color: theme.textMain }]} numberOfLines={1}>
                      {currentUser.display_name}
                    </Text>
                    <Text style={[styles.profileEmail, { color: theme.textMuted }]} numberOfLines={1}>
                      {currentUser.email}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={handleLogoutPress}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="log-out" size={15} color={colors.danger} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[
                  styles.guestCard,
                  {
                    backgroundColor: colors.primaryLight,
                    borderColor: colors.primaryBorder,
                  },
                ]}
                onPress={() => {
                  onClose();
                  onOpenAuth();
                }}
                activeOpacity={0.8}
              >
                <View style={styles.guestLeft}>
                  <Ionicons name="person-circle-outline" size={24} color={colors.primary} />
                  <View>
                    <Text style={[styles.guestTitle, { color: colors.primary }]}>Sign In / Register</Text>
                    <Text style={[styles.guestSubtitle, { color: theme.textMuted }]}>
                      Sync history & documents
                    </Text>
                  </View>
                </View>
                <Feather name="arrow-right" size={14} color={colors.primary} />
              </TouchableOpacity>
            )}

            {/* Conversation History Section */}
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>CHATS</Text>
              <Text style={[styles.sectionCount, { color: theme.textMuted }]}>
                {currentUser ? sessionList.length : 'Guest'}
              </Text>
            </View>

            {sessionList.length === 0 ? (
              <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                {currentUser ? 'No conversations yet.' : 'Temporary guest chats.'}
              </Text>
            ) : (
              sessionList.map((s) => {
                const isActive = s.id === activeSessionId;
                const isWeb = s.mode === 'WEB_SEARCH';

                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[
                      styles.sessionItem,
                      {
                        backgroundColor: isActive ? colors.primaryLight : 'transparent',
                        borderColor: isActive ? colors.primaryBorder : 'transparent',
                      },
                    ]}
                    onPress={() => handleSelect(s.id)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={isWeb ? 'globe-outline' : 'document-text-outline'}
                      size={14}
                      color={isActive ? colors.primary : theme.textMuted}
                    />
                    <Text
                      style={[
                        styles.sessionTitle,
                        {
                          color: isActive ? colors.primary : theme.textMain,
                          fontWeight: isActive ? '700' : '500',
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {s.title}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleDeletePress(s.id, s.title)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Feather name="trash-2" size={13} color={theme.textMuted} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })
            )}

            {/* Session Documents Section */}
            {docList.length > 0 && (
              <>
                <View style={[styles.sectionHeader, { marginTop: 16 }]}>
                  <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>ATTACHED DOCUMENTS</Text>
                  <Text style={[styles.sectionCount, { color: theme.textMuted }]}>
                    {docList.length}
                  </Text>
                </View>

                {docList.map((doc) => (
                  <View
                    key={doc.document_id}
                    style={[
                      styles.docItem,
                      {
                        backgroundColor: theme.bgInput,
                        borderColor: theme.borderSubtle,
                      },
                    ]}
                  >
                    <Feather name="file" size={13} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.docName, { color: theme.textMain }]} numberOfLines={1}>
                        {doc.filename}
                      </Text>
                      <Text style={[styles.docMeta, { color: theme.textMuted }]}>
                        {doc.total_chunks} chunks • {(doc.file_size_bytes / 1024).toFixed(1)} KB
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => onDeleteDocument(doc.document_id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Feather name="x" size={13} color={theme.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          {/* Bottom Settings / Server IP Connection */}
          <View style={[styles.bottomBar, { borderTopColor: theme.borderSubtle }]}>
            <TouchableOpacity
              style={[styles.serverConfigBtn, { backgroundColor: theme.borderSubtle }]}
              onPress={() => {
                onClose();
                onOpenServerConfig();
              }}
              activeOpacity={0.7}
            >
              <Feather name="server" size={13} color={theme.textMuted} />
              <Text style={[styles.serverConfigText, { color: theme.textMuted }]}>
                Backend Server IP / Wi-Fi
              </Text>
              <Feather name="settings" size={13} color={theme.textMuted} style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  drawer: {
    width: '82%',
    maxWidth: 320,
    height: '100%',
    borderRightWidth: 1,
    paddingTop: 50,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  brandLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  brandSubtitle: {
    fontSize: 10,
    fontWeight: '500',
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newChatBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 14,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  newChatText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  scrollArea: {
    flex: 1,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  scrollContent: {
    paddingVertical: 8,
    gap: 4,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  profileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  profileAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  profileName: {
    fontSize: 13,
    fontWeight: '700',
  },
  profileEmail: {
    fontSize: 11,
  },
  guestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  guestLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  guestTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  guestSubtitle: {
    fontSize: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 2,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  sectionCount: {
    fontSize: 10,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  sessionTitle: {
    fontSize: 13,
    flex: 1,
  },
  docItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  docName: {
    fontSize: 12,
    fontWeight: '600',
  },
  docMeta: {
    fontSize: 10,
  },
  bottomBar: {
    padding: 12,
    borderTopWidth: 1,
  },
  serverConfigBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  serverConfigText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
