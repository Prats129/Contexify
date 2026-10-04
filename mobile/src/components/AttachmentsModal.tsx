import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  FlatList,
  Image,
  ActivityIndicator,
  Alert,
  Dimensions,
  Animated,
  PanResponder,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { getAppTheme, type AppTheme } from "../theme/colors";
import { apiService } from "../services/api";
import type {
  AssetItem,
  MediaAttachment,
  DocumentMetadata,
  User,
} from "../types";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const CARD_MARGIN = 6;
const CARD_WIDTH = (SCREEN_WIDTH - 32 - CARD_MARGIN * 2) / 2;

interface AttachmentsModalProps {
  visible: boolean;
  onClose: () => void;
  currentUser: User | null;
  activeSessionId: string | null;
  activeSessionTitle?: string;
  onAttachMedia?: (media: MediaAttachment) => void;
  onAttachDocument?: (doc: DocumentMetadata) => void;
  onAssetDeleted?: (assetId: string) => void;
  isDark?: boolean;
  theme?: AppTheme;
}

type TabFilter = "all" | "upload" | "generated" | "document";

export const AttachmentsModal: React.FC<AttachmentsModalProps> = ({
  visible,
  onClose,
  currentUser,
  activeSessionId,
  activeSessionTitle,
  onAttachMedia,
  onAttachDocument,
  onAssetDeleted,
  isDark = true,
  theme: customTheme,
}) => {
  const theme = customTheme || getAppTheme(isDark);

  const [scope, setScope] = useState<"session" | "all">(() =>
    activeSessionId ? "session" : "all",
  );
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Lightbox preview state
  const [previewAsset, setPreviewAsset] = useState<AssetItem | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  // Search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 280);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Entrance and exit animation
  useEffect(() => {
    if (visible) {
      if (activeSessionId) {
        setScope("session");
      } else {
        setScope("all");
      }
      translateY.setValue(SCREEN_HEIGHT);
      Animated.spring(translateY, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, activeSessionId]);

  const handleClose = () => {
    Animated.timing(translateY, {
      toValue: SCREEN_HEIGHT,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 12,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 120 || gestureState.vy > 0.6) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          handleClose();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            tension: 70,
            friction: 10,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  // Fetch unified assets
  const fetchAssets = useCallback(
    async (isPageAppend = false, isPullRefresh = false) => {
      if (!visible) return;

      const currentOffset = isPageAppend ? offset : 0;
      if (isPullRefresh) {
        setIsRefreshing(true);
      } else if (isPageAppend) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      try {
        let originParam: "upload" | "generated" | "all" = "all";
        let fileTypeParam: "image" | "document" | "all" = "all";

        if (activeTab === "upload") {
          originParam = "upload";
        } else if (activeTab === "generated") {
          originParam = "generated";
          fileTypeParam = "image";
        } else if (activeTab === "document") {
          fileTypeParam = "document";
        }

        const res = await apiService.getAssets({
          userId: currentUser?.id,
          sessionId:
            scope === "session" && activeSessionId
              ? activeSessionId
              : undefined,
          origin: originParam,
          fileType: fileTypeParam,
          search: debouncedSearch || undefined,
          limit: 20,
          offset: currentOffset,
        });

        if (isPageAppend) {
          setAssets((prev) => [...prev, ...res.items]);
        } else {
          setAssets(res.items);
        }
        setTotal(res.total);
        setHasMore(res.has_more);
        setOffset(currentOffset + res.items.length);
      } catch (err) {
        console.warn("Failed to load mobile assets:", err);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
        setIsRefreshing(false);
      }
    },
    [
      visible,
      scope,
      activeSessionId,
      currentUser?.id,
      activeTab,
      debouncedSearch,
      offset,
    ],
  );

  useEffect(() => {
    if (visible) {
      fetchAssets(false);
    }
  }, [visible, scope, activeTab, debouncedSearch]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2400);
  };

  const handleAttachItem = (item: AssetItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (item.file_type === "image" && onAttachMedia) {
      const media: MediaAttachment = {
        id: item.id,
        url: item.url,
        file_type: "image",
        file_name: item.name,
        mime_type: item.mime_type || "image/png",
        file_size_bytes: item.size_bytes,
        media_type: item.origin,
        prompt: item.prompt,
      };
      onAttachMedia(media);
      showToast(`Attached "${item.name}"`);
    } else if (item.file_type === "document" && onAttachDocument) {
      const doc: DocumentMetadata = {
        document_id: item.id,
        session_id: item.session_id || activeSessionId || "",
        filename: item.name,
        file_type: item.mime_type || ".pdf",
        file_size_bytes: item.size_bytes,
        total_chunks: 0,
        storage_url: item.url,
        uploaded_at: item.created_at,
      };
      onAttachDocument(doc);
      showToast(`Attached document "${item.name}"`);
    }
  };

  const handleDeleteItem = (item: AssetItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Delete Attachment",
      `Are you sure you want to permanently delete "${item.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await apiService.deleteAsset(item.id);
              setAssets((prev) => prev.filter((a) => a.id !== item.id));
              setTotal((prev) => Math.max(0, prev - 1));
              if (previewAsset?.id === item.id) {
                setPreviewAsset(null);
              }
              if (onAssetDeleted) {
                onAssetDeleted(item.id);
              }
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
              showToast(`Deleted "${item.name}"`);
            } catch (e: any) {
              Alert.alert("Error", e?.message || "Failed to delete item.");
            }
          },
        },
      ],
    );
  };

  const handleCopyPrompt = async (prompt?: string) => {
    if (!prompt) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleOpenExternal = async (url: string) => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Error", "Could not open attachment link.");
    }
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return "0 KB";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatRelativeTime = (isoString?: string): string => {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);

      if (diffSecs < 60) return "Just now";
      if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
      if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  };

  const renderCard = ({ item }: { item: AssetItem }) => {
    const isImage = item.file_type === "image";
    const isGenerated = item.origin === "generated";

    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.bgCard,
            borderColor: theme.borderSubtle,
          },
        ]}
      >
        {/* Thumbnail area */}
        <TouchableOpacity
          style={styles.thumbnailWrapper}
          onPress={() => {
            Haptics.selectionAsync();
            setPreviewAsset(item);
          }}
          activeOpacity={0.85}
        >
          {isImage ? (
            <Image
              source={{ uri: item.url }}
              style={styles.thumbnailImage}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[styles.docThumbnail, { backgroundColor: theme.bgInput }]}
            >
              <Ionicons
                name={
                  item.name.endsWith(".pdf") ? "document-text" : "code-slash"
                }
                size={32}
                color={item.name.endsWith(".pdf") ? "#ef4444" : theme.primary}
              />
              <Text
                style={[styles.docExt, { color: theme.textMuted }]}
                numberOfLines={1}
              >
                {item.name.split(".").pop()?.toUpperCase() || "FILE"}
              </Text>
            </View>
          )}

          {/* Badge */}
          <View style={styles.badgeContainer}>
            {isGenerated ? (
              <View style={styles.genBadge}>
                <Ionicons name="sparkles" size={10} color="#000" />
                <Text style={styles.genBadgeText}>AI Gen</Text>
              </View>
            ) : (
              <View style={styles.uploadBadge}>
                <Feather
                  name={isImage ? "image" : "file-text"}
                  size={10}
                  color="#fff"
                />
                <Text style={styles.uploadBadgeText}>
                  {isImage ? "Photo" : "Doc"}
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        {/* Card info & Quick action */}
        <View style={styles.cardInfo}>
          <Text
            style={[styles.cardTitle, { color: theme.textMain }]}
            numberOfLines={1}
          >
            {item.name}
          </Text>

          <View style={styles.cardMetaRow}>
            <Text style={[styles.cardMetaText, { color: theme.textMuted }]}>
              {formatFileSize(item.size_bytes)}
            </Text>
            <Text style={[styles.cardMetaText, { color: theme.textMuted }]}>
              {formatRelativeTime(item.created_at)}
            </Text>
          </View>

          {/* Action Row */}
          <View style={styles.cardActionRow}>
            <TouchableOpacity
              style={[styles.attachButton, { backgroundColor: theme.primary }]}
              onPress={() => handleAttachItem(item)}
              activeOpacity={0.8}
            >
              <Feather name="plus" size={13} color="#fff" />
              <Text style={styles.attachButtonText}>Attach</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.iconActionBtn,
                { backgroundColor: theme.borderSubtle },
              ]}
              onPress={() => handleDeleteItem(item)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Feather name="trash-2" size={13} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  if (!visible || !currentUser) return null;

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: theme.bgApp,
              transform: [{ translateY }],
            },
          ]}
        >
          <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
            {/* Gesture pull handle */}
            <View
              style={styles.dragHandleContainer}
              {...panResponder.panHandlers}
            >
              <View
                style={[
                  styles.dragHandle,
                  { backgroundColor: theme.borderSubtle },
                ]}
              />
            </View>

            {/* Header */}
            <View
              style={[
                styles.header,
                {
                  borderBottomColor: theme.borderSubtle,
                },
              ]}
            >
              <View style={styles.headerLeft}>
                <View
                  style={[
                    styles.headerIconWrapper,
                    { backgroundColor: theme.primaryLight },
                  ]}
                >
                  <Feather name="paperclip" size={17} color={theme.primary} />
                </View>
                <View style={styles.headerTitles}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.title, { color: theme.textMain }]}>
                      Media & Files
                    </Text>
                    <View
                      style={[
                        styles.countPill,
                        { backgroundColor: theme.borderSubtle },
                      ]}
                    >
                      <Text
                        style={[
                          styles.countPillText,
                          { color: theme.textMuted },
                        ]}
                      >
                        {total}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.subtitle, { color: theme.textMuted }]}>
                    Unified attachments library
                  </Text>
                </View>
              </View>

              <View style={styles.headerRight}>
                <TouchableOpacity
                  style={[
                    styles.roundBtn,
                    { backgroundColor: theme.borderSubtle },
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    fetchAssets(false);
                  }}
                  disabled={isLoading}
                >
                  <Feather name="refresh-cw" size={14} color={theme.textMain} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.roundBtn,
                    { backgroundColor: theme.borderSubtle },
                  ]}
                  onPress={handleClose}
                >
                  <Feather name="x" size={17} color={theme.textMain} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Toast feedback */}
            {toastMessage && (
              <View style={styles.toast}>
                <Feather name="check" size={13} color="#fff" />
                <Text style={styles.toastText}>{toastMessage}</Text>
              </View>
            )}

            {/* Controls: Scope Switcher + Tabs + Search */}
            <View style={styles.controlsSection}>
              {/* Scope Switcher (This Chat vs All Chats) */}
              {activeSessionId && (
                <View
                  style={[
                    styles.scopeContainer,
                    {
                      backgroundColor: theme.bgInput,
                      borderColor: theme.borderSubtle,
                    },
                  ]}
                >
                  <TouchableOpacity
                    style={[
                      styles.scopeBtn,
                      scope === "session" && {
                        backgroundColor: theme.bgCard,
                        elevation: 1,
                      },
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setScope("session");
                    }}
                  >
                    <Text
                      style={[
                        styles.scopeText,
                        {
                          color:
                            scope === "session"
                              ? theme.textMain
                              : theme.textMuted,
                          fontWeight: scope === "session" ? "700" : "500",
                        },
                      ]}
                    >
                      This Chat
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.scopeBtn,
                      scope === "all" && {
                        backgroundColor: theme.bgCard,
                        elevation: 1,
                      },
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setScope("all");
                    }}
                  >
                    <Text
                      style={[
                        styles.scopeText,
                        {
                          color:
                            scope === "all" ? theme.textMain : theme.textMuted,
                          fontWeight: scope === "all" ? "700" : "500",
                        },
                      ]}
                    >
                      All Chats
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Filter Tabs */}
              <View style={styles.tabsRow}>
                {(
                  [
                    { id: "all", label: "All" },
                    { id: "upload", label: "Uploaded", icon: "upload" },
                    { id: "generated", label: "AI Gen", icon: "sparkles" },
                    { id: "document", label: "Docs", icon: "file-text" },
                  ] as Array<{ id: TabFilter; label: string; icon?: string }>
                ).map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <TouchableOpacity
                      key={tab.id}
                      style={[
                        styles.tabBtn,
                        {
                          backgroundColor: isActive
                            ? theme.primary
                            : theme.borderSubtle,
                        },
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setActiveTab(tab.id);
                      }}
                      activeOpacity={0.7}
                    >
                      {tab.icon === "sparkles" ? (
                        <Ionicons
                          name="sparkles"
                          size={12}
                          color={isActive ? "#fff" : "#f59e0b"}
                        />
                      ) : tab.icon ? (
                        <Feather
                          name={tab.icon as any}
                          size={12}
                          color={isActive ? "#fff" : theme.textMuted}
                        />
                      ) : null}
                      <Text
                        style={[
                          styles.tabText,
                          {
                            color: isActive ? "#fff" : theme.textMuted,
                            fontWeight: isActive ? "700" : "500",
                          },
                        ]}
                      >
                        {tab.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Search Bar */}
              <View
                style={[
                  styles.searchBar,
                  {
                    backgroundColor: theme.bgInput,
                    borderColor: theme.borderSubtle,
                  },
                ]}
              >
                <Feather
                  name="search"
                  size={14}
                  color={theme.textMuted}
                  style={{ marginRight: 6 }}
                />
                <TextInput
                  style={[styles.searchInput, { color: theme.textMain }]}
                  placeholder="Search filename or prompt..."
                  placeholderTextColor={theme.textMuted}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  returnKeyType="search"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setSearchQuery("")}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="x" size={14} color={theme.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Assets List */}
            {isLoading && assets.length === 0 ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={[styles.loadingText, { color: theme.textMuted }]}>
                  Loading media...
                </Text>
              </View>
            ) : assets.length === 0 ? (
              <View style={styles.centerContainer}>
                <View
                  style={[
                    styles.emptyIconCircle,
                    { backgroundColor: theme.borderSubtle },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={
                      activeTab === "generated"
                        ? "image-auto-adjust"
                        : activeTab === "document"
                          ? "file-document-outline"
                          : "folder-multiple-image"
                    }
                    size={36}
                    color={theme.textMuted}
                  />
                </View>
                <Text style={[styles.emptyTitle, { color: theme.textMain }]}>
                  {debouncedSearch
                    ? "No matching attachments"
                    : activeTab === "generated"
                      ? "No AI generated images"
                      : activeTab === "document"
                        ? "No documents attached"
                        : "No media or attachments"}
                </Text>
                <Text
                  style={[styles.emptySubtitle, { color: theme.textMuted }]}
                >
                  {debouncedSearch
                    ? "Try adjusting your search terms"
                    : "Files and images shared or generated will show up here."}
                </Text>
              </View>
            ) : (
              <FlatList
                data={assets}
                keyExtractor={(item) => item.id}
                numColumns={2}
                renderItem={renderCard}
                contentContainerStyle={styles.listContent}
                refreshing={isRefreshing}
                onRefresh={() => fetchAssets(false, true)}
                onEndReached={() => {
                  if (hasMore && !isLoadingMore) {
                    fetchAssets(true);
                  }
                }}
                onEndReachedThreshold={0.3}
                ListFooterComponent={
                  isLoadingMore ? (
                    <View style={styles.listFooter}>
                      <ActivityIndicator size="small" color={theme.primary} />
                    </View>
                  ) : null
                }
              />
            )}
          </SafeAreaView>
        </Animated.View>

        {/* Lightbox / Preview Modal */}
        {previewAsset && (
          <Modal
            visible={!!previewAsset}
            transparent
            animationType="fade"
            onRequestClose={() => setPreviewAsset(null)}
          >
            <View style={styles.lightboxBackdrop}>
              <SafeAreaView
                edges={["top", "bottom"]}
                style={styles.lightboxSafeArea}
              >
                {/* Topbar */}
                <View style={styles.lightboxHeader}>
                  <View style={styles.lightboxHeaderLeft}>
                    <Text style={styles.lightboxTitle} numberOfLines={1}>
                      {previewAsset.name}
                    </Text>
                    <Text style={styles.lightboxSubtitle}>
                      {formatFileSize(previewAsset.size_bytes)} •{" "}
                      {previewAsset.origin === "generated"
                        ? "AI Generated"
                        : "Upload"}
                    </Text>
                  </View>

                  <View style={styles.lightboxHeaderRight}>
                    <TouchableOpacity
                      style={styles.lightboxIconBtn}
                      onPress={() => handleOpenExternal(previewAsset.url)}
                    >
                      <Feather name="external-link" size={17} color="#fff" />
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.lightboxIconBtn}
                      onPress={() => handleDeleteItem(previewAsset)}
                    >
                      <Feather name="trash-2" size={17} color="#ef4444" />
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.lightboxIconBtn}
                      onPress={() => setPreviewAsset(null)}
                    >
                      <Feather name="x" size={19} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Center Content */}
                <View style={styles.lightboxBody}>
                  {previewAsset.file_type === "image" ? (
                    <Image
                      source={{ uri: previewAsset.url }}
                      style={styles.lightboxImage}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={styles.lightboxDocBox}>
                      <Ionicons
                        name="document-text"
                        size={64}
                        color={theme.primary}
                      />
                      <Text style={styles.lightboxDocName} numberOfLines={2}>
                        {previewAsset.name}
                      </Text>
                      <Text style={styles.lightboxDocMeta}>
                        {formatFileSize(previewAsset.size_bytes)}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Bottom Details Bar (Prompt & Attach action) */}
                <View style={styles.lightboxBottomBar}>
                  {previewAsset.origin === "generated" &&
                  previewAsset.prompt ? (
                    <View style={styles.promptBox}>
                      <View style={styles.promptHeader}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Ionicons name="sparkles" size={13} color="#f59e0b" />
                          <Text style={styles.promptLabel}>Prompt</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.copyPromptBtn}
                          onPress={() => handleCopyPrompt(previewAsset.prompt)}
                        >
                          <Feather
                            name={copiedPrompt ? "check" : "copy"}
                            size={12}
                            color="#fff"
                          />
                          <Text style={styles.copyPromptText}>
                            {copiedPrompt ? "Copied" : "Copy"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.promptContent} numberOfLines={3}>
                        "{previewAsset.prompt}"
                      </Text>
                    </View>
                  ) : null}

                  <TouchableOpacity
                    style={[
                      styles.lightboxAttachBtn,
                      { backgroundColor: theme.primary },
                    ]}
                    onPress={() => {
                      handleAttachItem(previewAsset);
                      setPreviewAsset(null);
                    }}
                    activeOpacity={0.85}
                  >
                    <Feather name="plus" size={17} color="#fff" />
                    <Text style={styles.lightboxAttachBtnText}>
                      Attach to Current Chat
                    </Text>
                  </TouchableOpacity>
                </View>
              </SafeAreaView>
            </View>
          </Modal>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  sheetContainer: {
    width: "100%",
    height: "94%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  safeArea: {
    flex: 1,
  },
  dragHandleContainer: {
    width: "100%",
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  headerIconWrapper: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitles: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
  },
  countPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
  },
  countPillText: {
    fontSize: 10,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  roundBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  toast: {
    position: "absolute",
    top: 60,
    alignSelf: "center",
    backgroundColor: "#10b981",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    zIndex: 100,
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  toastText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  controlsSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
  },
  scopeContainer: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 2,
  },
  scopeBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: "center",
    borderRadius: 8,
  },
  scopeText: {
    fontSize: 12,
  },
  tabsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tabBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  tabText: {
    fontSize: 12,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    paddingVertical: 0,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  card: {
    width: CARD_WIDTH,
    margin: CARD_MARGIN,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  thumbnailWrapper: {
    width: "100%",
    height: CARD_WIDTH * 0.9,
    position: "relative",
  },
  thumbnailImage: {
    width: "100%",
    height: "100%",
  },
  docThumbnail: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  docExt: {
    fontSize: 10,
    fontWeight: "700",
  },
  badgeContainer: {
    position: "absolute",
    top: 6,
    left: 6,
  },
  genBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(245, 158, 11, 0.92)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  genBadgeText: {
    color: "#000",
    fontSize: 9,
    fontWeight: "800",
  },
  uploadBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  uploadBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "600",
  },
  cardInfo: {
    padding: 8,
    gap: 4,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: "600",
  },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardMetaText: {
    fontSize: 10,
  },
  cardActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  attachButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 5,
    borderRadius: 6,
  },
  attachButtonText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  iconActionBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    marginTop: 6,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  emptySubtitle: {
    fontSize: 12,
    textAlign: "center",
    maxWidth: 240,
  },
  listFooter: {
    paddingVertical: 14,
    alignItems: "center",
  },
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
  },
  lightboxSafeArea: {
    flex: 1,
    justifyContent: "space-between",
  },
  lightboxHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  lightboxHeaderLeft: {
    flex: 1,
    marginRight: 12,
  },
  lightboxTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  lightboxSubtitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    marginTop: 2,
  },
  lightboxHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  lightboxIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightboxBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  lightboxImage: {
    width: "100%",
    height: "100%",
  },
  lightboxDocBox: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    padding: 32,
    borderRadius: 20,
    gap: 8,
  },
  lightboxDocName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  lightboxDocMeta: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
  },
  lightboxBottomBar: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 10,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  promptBox: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  promptHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  promptLabel: {
    color: "#f59e0b",
    fontSize: 11,
    fontWeight: "700",
  },
  copyPromptBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  copyPromptText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
  },
  promptContent: {
    color: "#fff",
    fontSize: 11,
    fontStyle: "italic",
    lineHeight: 16,
  },
  lightboxAttachBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  lightboxAttachBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});
