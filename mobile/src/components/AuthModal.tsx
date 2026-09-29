import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  PanResponder,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { getAppTheme, type AppTheme } from "../theme/colors";
import { apiService } from "../services/api";
import {
  PasswordStrengthMeter,
  checkPasswordStrength,
} from "./PasswordStrengthMeter";
import type { User } from "../types";

WebBrowser.maybeCompleteAuthSession();

interface AuthModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
  isDark?: boolean;
  theme?: AppTheme;
}

type TabType = "login" | "otp" | "register";

export const AuthModal: React.FC<AuthModalProps> = ({
  visible,
  onClose,
  onSuccess,
  isDark = true,
  theme: customTheme,
}) => {
  const theme = customTheme || getAppTheme(isDark);
  const [activeTab, setActiveTab] = useState<TabType>("login");

  // Form Fields
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // OTP Fields
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  // Registration Fields
  const [regName, setRegName] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");

  // Status
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const regStrength = useMemo(
    () =>
      checkPasswordStrength(regPassword, {
        username: regUsername,
        email: regEmail,
        displayName: regName,
      }),
    [regPassword, regUsername, regEmail, regName],
  );

  const isRegisterValid = useMemo(
    () =>
      Boolean(regName.trim()) &&
      regUsername.trim().length >= 3 &&
      Boolean(regEmail.trim()) &&
      regPassword.length >= 8 &&
      regStrength.isValid,
    [regName, regUsername, regEmail, regPassword, regStrength],
  );

  const translateY = useRef(new Animated.Value(700)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(700);
      Animated.spring(translateY, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const handleClose = () => {
    Animated.timing(translateY, {
      toValue: 700,
      duration: 160,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 4,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 65 || gestureState.vy > 0.45) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          Animated.timing(translateY, {
            toValue: 700,
            duration: 160,
            useNativeDriver: true,
          }).start(() => {
            onClose();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            velocity: gestureState.vy,
            tension: 65,
            friction: 10,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  const resetForm = () => {
    setIdentifier("");
    setPassword("");
    setShowPassword(false);
    setOtpEmail("");
    setOtpSent(false);
    setOtpCode("");
    setRegName("");
    setRegUsername("");
    setRegEmail("");
    setRegPassword("");
    setErrorMessage(null);
    setGoogleLoading(false);
  };

  const handlePasswordLogin = async () => {
    if (!identifier.trim() || !password.trim()) {
      setErrorMessage("Please enter both username/email and password.");
      return;
    }
    setErrorMessage(null);
    setLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const user = await apiService.login(identifier.trim(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      resetForm();
      onSuccess(user);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async () => {
    if (!otpEmail.trim()) {
      setErrorMessage("Please enter your registered email address.");
      return;
    }
    setErrorMessage(null);
    setLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await apiService.sendOtp(otpEmail.trim());
      setOtpSent(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode.trim() || otpCode.length < 6) {
      setErrorMessage("Please enter the complete 6-digit OTP.");
      return;
    }
    setErrorMessage(null);
    setLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const user = await apiService.loginWithOtp(
        otpEmail.trim(),
        otpCode.trim(),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      resetForm();
      onSuccess(user);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setErrorMessage(null);

    const trimmedName = regName.trim();
    const trimmedUsername = regUsername.trim();
    const trimmedEmail = regEmail.trim();

    if (!trimmedName) {
      setErrorMessage("Please enter your full name.");
      return;
    }
    if (trimmedUsername.length < 3) {
      setErrorMessage("Username must be at least 3 characters long.");
      return;
    }
    if (!trimmedEmail) {
      setErrorMessage("Please enter your email address.");
      return;
    }
    if (!trimmedEmail.includes("@") || !trimmedEmail.includes(".")) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }
    if (regPassword.length < 8) {
      setErrorMessage("Password must be at least 8 characters long.");
      return;
    }
    if (!regStrength.isValid) {
      setErrorMessage(
        regStrength.feedback ||
          "Please satisfy all password security requirements above.",
      );
      return;
    }

    setLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const user = await apiService.register(
        trimmedName,
        trimmedUsername,
        trimmedEmail,
        regPassword,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      resetForm();
      onSuccess(user);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setErrorMessage(null);
    const clientId =
      process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
      "340672806744-bifsblkj1h07q1iriuhnb7foecav36qj.apps.googleusercontent.com";

    if (!clientId) {
      setErrorMessage("Google Sign-In is not configured.");
      return;
    }

    try {
      setGoogleLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const isExpoGo =
        Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

      // 1. Production Standalone / EAS builds: Native Google Play Services & iOS One-Tap
      if (!isExpoGo && Platform.OS !== "web") {
        let GoogleSignin: any = null;
        let statusCodes: any = null;

        try {
          // Dynamically loaded so Expo Go runtime does not trigger unlinked native TurboModule errors
          const gModule = require("@react-native-google-signin/google-signin");
          GoogleSignin = gModule.GoogleSignin;
          statusCodes = gModule.statusCodes;
        } catch {
          // Native module not linked in current runtime; gracefully fall back to web/browser auth
        }

        if (GoogleSignin) {
          try {
            GoogleSignin.configure({
              webClientId: clientId,
              offlineAccess: false,
            });

            await GoogleSignin.hasPlayServices({
              showPlayServicesUpdateDialog: true,
            });
            const response = await GoogleSignin.signIn();

            if (response.type === "success" && response.data) {
              const { user: gUser, idToken } = response.data;
              const user = await apiService.loginWithGoogle({
                credential: idToken || undefined,
                email: gUser.email,
                name: gUser.name || undefined,
                picture: gUser.photo || undefined,
                google_id: gUser.id,
              });

              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
              resetForm();
              onSuccess(user);
              onClose();
              return;
            } else if (response.type === "cancelled") {
              return;
            }
          } catch (nativeErr: any) {
            if (
              statusCodes &&
              nativeErr?.code === statusCodes.SIGN_IN_CANCELLED
            ) {
              return;
            }
            if (
              statusCodes &&
              nativeErr?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE
            ) {
              throw new Error(
                "Google Play Services is not available or outdated on this device.",
              );
            }
            throw nativeErr;
          }
        }
      }

      // 2. Development (Expo Go) and Web fallback flow
      let startUrl: string;
      let returnUrl: string;

      if (Platform.OS === "web") {
        returnUrl =
          typeof window !== "undefined"
            ? window.location.origin
            : "http://localhost:5173";
        startUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
          clientId,
        )}&redirect_uri=${encodeURIComponent(
          returnUrl,
        )}&response_type=token&scope=${encodeURIComponent(
          "openid email profile",
        )}&prompt=select_account`;
      } else {
        const proxyUri = "https://auth.expo.io/@prats129/contexify";
        returnUrl = Linking.createURL("expo-auth-session");

        const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
          clientId,
        )}&redirect_uri=${encodeURIComponent(
          proxyUri,
        )}&response_type=token&scope=${encodeURIComponent(
          "openid email profile",
        )}&prompt=select_account`;

        // The Expo Auth Proxy (auth.expo.io) must be initialized via /start with authUrl & returnUrl
        // so that it can store returnUrl in its session and redirect back into the mobile app upon completion.
        startUrl = `${proxyUri}/start?authUrl=${encodeURIComponent(
          googleAuthUrl,
        )}&returnUrl=${encodeURIComponent(returnUrl)}`;
      }

      const result = await WebBrowser.openAuthSessionAsync(startUrl, returnUrl);

      if (result.type === "success" && result.url) {
        if (result.url.includes("errorCode=login-declined")) {
          return;
        }

        const rawParams = result.url.includes("#")
          ? result.url.split("#")[1]
          : result.url.includes("?")
            ? result.url.split("?")[1]
            : "";
        const params = new URLSearchParams(rawParams);
        const accessToken = params.get("access_token");

        if (accessToken) {
          const userInfoRes = await fetch(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            },
          );

          if (userInfoRes.ok) {
            const info = await userInfoRes.json();
            const user = await apiService.loginWithGoogle({
              email: info.email,
              name: info.name,
              picture: info.picture,
              google_id: info.sub,
            });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            resetForm();
            onSuccess(user);
            onClose();
            return;
          } else {
            throw new Error("Failed to retrieve profile from Google.");
          }
        } else if (result.url.includes("error=")) {
          const errorDesc =
            params.get("error_description") || params.get("error");
          if (errorDesc?.includes("redirect_uri_mismatch")) {
            throw new Error(
              `Google OAuth Redirect URI mismatch.\nPlease add this URL to your Google Cloud Console Authorized redirect URIs:\nhttps://auth.expo.io/@prats129/contexify`,
            );
          }
          throw new Error(
            errorDesc || "Google authentication was rejected or cancelled.",
          );
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardContainer}
      >
        <Pressable style={styles.backdrop} onPress={handleClose}>
          <Animated.View
            onStartShouldSetResponder={() => true}
            style={[
              styles.sheet,
              {
                backgroundColor: theme.bgCard,
                borderColor: theme.borderHover,
                transform: [{ translateY }],
              },
            ]}
          >
            {/* Top Handle & Header (Draggable to close) */}
            <View {...panResponder.panHandlers}>
              <View style={styles.handleRow}>
                <View
                  style={[
                    styles.handleBar,
                    { backgroundColor: theme.textMuted },
                  ]}
                />
              </View>

              {/* Header */}
              <View
                style={[
                  styles.headerRow,
                  { borderBottomColor: theme.borderSubtle },
                ]}
              >
                <View style={styles.headerLeft}>
                  <View
                    style={[
                      styles.logoIcon,
                      { backgroundColor: theme.primary },
                    ]}
                  >
                    <Ionicons
                      name="shield-checkmark"
                      size={14}
                      color="#ffffff"
                    />
                  </View>
                  <Text style={[styles.title, { color: theme.textMain }]}>
                    Authentication
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.closeBtn,
                    { backgroundColor: theme.borderSubtle },
                  ]}
                  onPress={handleClose}
                >
                  <Feather name="x" size={16} color={theme.textMain} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Navigation Tabs */}
            <View style={[styles.tabsRow, { backgroundColor: theme.bgInput }]}>
              <TouchableOpacity
                style={[
                  styles.tabBtn,
                  activeTab === "login" && [
                    styles.activeTab,
                    { backgroundColor: theme.bgCard },
                  ],
                ]}
                onPress={() => {
                  setActiveTab("login");
                  setErrorMessage(null);
                }}
              >
                <Text
                  style={[
                    styles.tabText,
                    {
                      color:
                        activeTab === "login" ? theme.primary : theme.textMuted,
                    },
                  ]}
                >
                  Sign In
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.tabBtn,
                  activeTab === "otp" && [
                    styles.activeTab,
                    { backgroundColor: theme.bgCard },
                  ],
                ]}
                onPress={() => {
                  setActiveTab("otp");
                  setErrorMessage(null);
                }}
              >
                <Text
                  style={[
                    styles.tabText,
                    {
                      color:
                        activeTab === "otp" ? theme.primary : theme.textMuted,
                    },
                  ]}
                >
                  Email OTP
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.tabBtn,
                  activeTab === "register" && [
                    styles.activeTab,
                    { backgroundColor: theme.bgCard },
                  ],
                ]}
                onPress={() => {
                  setActiveTab("register");
                  setErrorMessage(null);
                }}
              >
                <Text
                  style={[
                    styles.tabText,
                    {
                      color:
                        activeTab === "register"
                          ? theme.primary
                          : theme.textMuted,
                    },
                  ]}
                >
                  Register
                </Text>
              </TouchableOpacity>
            </View>

            {/* Error Message Box */}
            {errorMessage && (
              <View
                style={[
                  styles.errorBox,
                  {
                    backgroundColor: theme.dangerLight,
                    borderColor: theme.danger,
                  },
                ]}
              >
                <Feather name="alert-circle" size={14} color={theme.danger} />
                <Text style={[styles.errorText, { color: theme.danger }]}>
                  {errorMessage}
                </Text>
              </View>
            )}

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.formContent}
            >
              {/* TAB 1: PASSWORD LOGIN */}
              {activeTab === "login" && (
                <View style={styles.formSection}>
                  {/* Google One-Click Sign In */}
                  <TouchableOpacity
                    style={[
                      styles.googleBtn,
                      {
                        backgroundColor: theme.bgInput,
                        borderColor: theme.borderSubtle,
                        opacity: loading || googleLoading ? 0.6 : 1,
                      },
                    ]}
                    onPress={handleGoogleAuth}
                    disabled={loading || googleLoading}
                    activeOpacity={0.8}
                  >
                    {googleLoading ? (
                      <ActivityIndicator color={theme.primary} size="small" />
                    ) : (
                      <>
                        <Ionicons
                          name="logo-google"
                          size={16}
                          color="#EA4335"
                        />
                        <Text
                          style={[
                            styles.googleBtnText,
                            { color: theme.textMain },
                          ]}
                        >
                          Continue with Google
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <View style={styles.dividerRow}>
                    <View
                      style={[
                        styles.dividerLine,
                        { backgroundColor: theme.borderSubtle },
                      ]}
                    />
                    <Text
                      style={[styles.dividerText, { color: theme.textMuted }]}
                    >
                      or continue with
                    </Text>
                    <View
                      style={[
                        styles.dividerLine,
                        { backgroundColor: theme.borderSubtle },
                      ]}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: theme.textMuted }]}>
                      Username or Email
                    </Text>
                    <View
                      style={[
                        styles.inputWrapper,
                        {
                          backgroundColor: theme.bgInput,
                          borderColor: theme.borderSubtle,
                        },
                      ]}
                    >
                      <Feather name="user" size={15} color={theme.textMuted} />
                      <TextInput
                        style={[styles.input, { color: theme.textMain }]}
                        placeholder="Enter username or email"
                        placeholderTextColor={theme.textMuted}
                        value={identifier}
                        onChangeText={setIdentifier}
                        autoCapitalize="none"
                      />
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: theme.textMuted }]}>
                      Password
                    </Text>
                    <View
                      style={[
                        styles.inputWrapper,
                        {
                          backgroundColor: theme.bgInput,
                          borderColor: theme.borderSubtle,
                        },
                      ]}
                    >
                      <Feather name="lock" size={15} color={theme.textMuted} />
                      <TextInput
                        style={[styles.input, { color: theme.textMain }]}
                        placeholder="Enter password"
                        placeholderTextColor={theme.textMuted}
                        secureTextEntry={!showPassword}
                        value={password}
                        onChangeText={setPassword}
                      />
                      <TouchableOpacity
                        onPress={() => setShowPassword(!showPassword)}
                      >
                        <Feather
                          name={showPassword ? "eye-off" : "eye"}
                          size={15}
                          color={theme.textMuted}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.submitBtn,
                      {
                        backgroundColor: theme.primary,
                        opacity: loading || googleLoading ? 0.6 : 1,
                      },
                    ]}
                    onPress={handlePasswordLogin}
                    disabled={loading || googleLoading}
                    activeOpacity={0.8}
                  >
                    {loading ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text style={styles.submitBtnText}>Sign In</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {/* TAB 2: EMAIL OTP */}
              {activeTab === "otp" && (
                <View style={styles.formSection}>
                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: theme.textMuted }]}>
                      Email Address
                    </Text>
                    <View
                      style={[
                        styles.inputWrapper,
                        {
                          backgroundColor: theme.bgInput,
                          borderColor: theme.borderSubtle,
                        },
                      ]}
                    >
                      <Feather name="mail" size={15} color={theme.textMuted} />
                      <TextInput
                        style={[styles.input, { color: theme.textMain }]}
                        placeholder="Enter your registered email"
                        placeholderTextColor={theme.textMuted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        value={otpEmail}
                        onChangeText={setOtpEmail}
                        editable={!otpSent}
                      />
                    </View>
                  </View>

                  {!otpSent ? (
                    <TouchableOpacity
                      style={[
                        styles.submitBtn,
                        { backgroundColor: theme.primary },
                      ]}
                      onPress={handleSendOtp}
                      disabled={loading}
                      activeOpacity={0.8}
                    >
                      {loading ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <Text style={styles.submitBtnText}>
                          Send One-Time Code
                        </Text>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <>
                      <View style={styles.inputGroup}>
                        <Text
                          style={[styles.label, { color: theme.textMuted }]}
                        >
                          6-Digit Code
                        </Text>
                        <View
                          style={[
                            styles.inputWrapper,
                            {
                              backgroundColor: theme.bgInput,
                              borderColor: theme.borderSubtle,
                            },
                          ]}
                        >
                          <Feather
                            name="key"
                            size={15}
                            color={theme.textMuted}
                          />
                          <TextInput
                            style={[
                              styles.input,
                              {
                                color: theme.textMain,
                                letterSpacing: 4,
                                fontWeight: "700",
                              },
                            ]}
                            placeholder="123456"
                            placeholderTextColor={theme.textMuted}
                            keyboardType="number-pad"
                            maxLength={6}
                            value={otpCode}
                            onChangeText={setOtpCode}
                          />
                        </View>
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.submitBtn,
                          { backgroundColor: theme.primary },
                        ]}
                        onPress={handleVerifyOtp}
                        disabled={loading}
                        activeOpacity={0.8}
                      >
                        {loading ? (
                          <ActivityIndicator color="#ffffff" size="small" />
                        ) : (
                          <Text style={styles.submitBtnText}>
                            Verify & Sign In
                          </Text>
                        )}
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}

              {/* TAB 3: REGISTER */}
              {activeTab === "register" && (
                <View style={styles.formSection}>
                  {/* Google One-Click Sign Up */}
                  <TouchableOpacity
                    style={[
                      styles.googleBtn,
                      {
                        backgroundColor: theme.bgInput,
                        borderColor: theme.borderSubtle,
                        opacity: loading || googleLoading ? 0.6 : 1,
                      },
                    ]}
                    onPress={handleGoogleAuth}
                    disabled={loading || googleLoading}
                    activeOpacity={0.8}
                  >
                    {googleLoading ? (
                      <ActivityIndicator color={theme.primary} size="small" />
                    ) : (
                      <>
                        <Ionicons
                          name="logo-google"
                          size={16}
                          color="#EA4335"
                        />
                        <Text
                          style={[
                            styles.googleBtnText,
                            { color: theme.textMain },
                          ]}
                        >
                          Sign up with Google
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <View style={styles.dividerRow}>
                    <View
                      style={[
                        styles.dividerLine,
                        { backgroundColor: theme.borderSubtle },
                      ]}
                    />
                    <Text
                      style={[styles.dividerText, { color: theme.textMuted }]}
                    >
                      or register with email
                    </Text>
                    <View
                      style={[
                        styles.dividerLine,
                        { backgroundColor: theme.borderSubtle },
                      ]}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: theme.textMuted }]}>
                      Full Name
                    </Text>
                    <View
                      style={[
                        styles.inputWrapper,
                        {
                          backgroundColor: theme.bgInput,
                          borderColor: theme.borderSubtle,
                        },
                      ]}
                    >
                      <Feather name="user" size={15} color={theme.textMuted} />
                      <TextInput
                        style={[styles.input, { color: theme.textMain }]}
                        placeholder="Alex Smith"
                        placeholderTextColor={theme.textMuted}
                        value={regName}
                        onChangeText={setRegName}
                      />
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: theme.textMuted }]}>
                      Username
                    </Text>
                    <View
                      style={[
                        styles.inputWrapper,
                        {
                          backgroundColor: theme.bgInput,
                          borderColor: theme.borderSubtle,
                        },
                      ]}
                    >
                      <Feather
                        name="at-sign"
                        size={15}
                        color={theme.textMuted}
                      />
                      <TextInput
                        style={[styles.input, { color: theme.textMain }]}
                        placeholder="alex_smith"
                        placeholderTextColor={theme.textMuted}
                        autoCapitalize="none"
                        value={regUsername}
                        onChangeText={setRegUsername}
                      />
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: theme.textMuted }]}>
                      Email Address
                    </Text>
                    <View
                      style={[
                        styles.inputWrapper,
                        {
                          backgroundColor: theme.bgInput,
                          borderColor: theme.borderSubtle,
                        },
                      ]}
                    >
                      <Feather name="mail" size={15} color={theme.textMuted} />
                      <TextInput
                        style={[styles.input, { color: theme.textMain }]}
                        placeholder="alex@example.com"
                        placeholderTextColor={theme.textMuted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        value={regEmail}
                        onChangeText={setRegEmail}
                      />
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: theme.textMuted }]}>
                      Password (min 8 characters)
                    </Text>
                    <View
                      style={[
                        styles.inputWrapper,
                        {
                          backgroundColor: theme.bgInput,
                          borderColor: theme.borderSubtle,
                        },
                      ]}
                    >
                      <Feather name="lock" size={15} color={theme.textMuted} />
                      <TextInput
                        style={[styles.input, { color: theme.textMain }]}
                        placeholder="Create strong, secure password"
                        placeholderTextColor={theme.textMuted}
                        secureTextEntry={!showPassword}
                        value={regPassword}
                        onChangeText={setRegPassword}
                      />
                      <TouchableOpacity
                        onPress={() => setShowPassword(!showPassword)}
                      >
                        <Feather
                          name={showPassword ? "eye-off" : "eye"}
                          size={15}
                          color={theme.textMuted}
                        />
                      </TouchableOpacity>
                    </View>
                    {regPassword.length > 0 && (
                      <PasswordStrengthMeter
                        result={regStrength}
                        theme={theme}
                      />
                    )}
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.submitBtn,
                      {
                        backgroundColor: isRegisterValid
                          ? theme.primary
                          : theme.borderSubtle || "rgba(255,255,255,0.1)",
                        opacity:
                          loading || googleLoading
                            ? 0.6
                            : isRegisterValid
                              ? 1
                              : 0.7,
                      },
                    ]}
                    onPress={handleRegister}
                    disabled={loading || googleLoading}
                    activeOpacity={0.8}
                  >
                    {loading ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text
                        style={[
                          styles.submitBtnText,
                          {
                            color: isRegisterValid
                              ? "#ffffff"
                              : theme.textMuted,
                          },
                        ]}
                      >
                        Create Account
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {/* Continue As Guest */}
              <TouchableOpacity
                style={styles.guestBtn}
                onPress={onClose}
                activeOpacity={0.7}
              >
                <Text style={[styles.guestBtnText, { color: theme.textMuted }]}>
                  Continue as Guest (Ephemeral Mode)
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  keyboardContainer: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "transparent",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "85%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  handleRow: {
    alignItems: "center",
    paddingVertical: 10,
  },
  handleBar: {
    width: 38,
    height: 4,
    borderRadius: 2,
    opacity: 0.3,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logoIcon: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  tabsRow: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 3,
    marginTop: 12,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: "center",
    borderRadius: 9,
  },
  activeTab: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 12,
    fontWeight: "700",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
  },
  errorText: {
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
  },
  formContent: {
    paddingVertical: 14,
    gap: 12,
  },
  formSection: {
    gap: 12,
  },
  inputGroup: {
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
  },
  submitBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  submitBtnText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  guestBtn: {
    alignItems: "center",
    paddingVertical: 10,
    marginTop: 4,
  },
  guestBtnText: {
    fontSize: 12,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  googleBtn: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 2,
  },
  googleBtnText: {
    fontSize: 13.5,
    fontWeight: "600",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});
