import React, { useState } from 'react';
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
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { getAppTheme, type AppTheme } from '../theme/colors';
import { apiService } from '../services/api';
import type { User } from '../types';

interface AuthModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
  isDark?: boolean;
  theme?: AppTheme;
}

type TabType = 'login' | 'otp' | 'register';

export const AuthModal: React.FC<AuthModalProps> = ({
  visible,
  onClose,
  onSuccess,
  isDark = true,
  theme: customTheme,
}) => {
  const theme = customTheme || getAppTheme(isDark);
  const [activeTab, setActiveTab] = useState<TabType>('login');

  // Form Fields
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // OTP Fields
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  // Registration Fields
  const [regName, setRegName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // Status
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetForm = () => {
    setIdentifier('');
    setPassword('');
    setOtpEmail('');
    setOtpCode('');
    setOtpSent(false);
    setRegName('');
    setRegUsername('');
    setRegEmail('');
    setRegPassword('');
    setErrorMessage(null);
  };

  const handlePasswordLogin = async () => {
    if (!identifier.trim() || !password.trim()) {
      setErrorMessage('Please enter both username/email and password.');
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
      setErrorMessage('Please enter your email address.');
      return;
    }
    setErrorMessage(null);
    setLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    if (!otpEmail.trim() || !otpCode.trim()) {
      setErrorMessage('Please enter the 6-digit OTP.');
      return;
    }
    setErrorMessage(null);
    setLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const user = await apiService.loginWithOtp(otpEmail.trim(), otpCode.trim());
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
    if (!regName.trim() || !regUsername.trim() || !regEmail.trim() || !regPassword.trim()) {
      setErrorMessage('Please fill in all required fields.');
      return;
    }
    if (regPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }
    setErrorMessage(null);
    setLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const user = await apiService.register(
        regName.trim(),
        regUsername.trim(),
        regEmail.trim(),
        regPassword
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.bgCard, borderColor: theme.borderHover }]}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Top Handle */}
            <View style={styles.handleRow}>
              <View style={[styles.handleBar, { backgroundColor: theme.textMuted }]} />
            </View>

            {/* Header */}
            <View style={[styles.headerRow, { borderBottomColor: theme.borderSubtle }]}>
              <View style={styles.headerLeft}>
                <View style={[styles.logoIcon, { backgroundColor: theme.primary }]}>
                  <Ionicons name="shield-checkmark" size={14} color="#ffffff" />
                </View>
                <Text style={[styles.title, { color: theme.textMain }]}>Authentication</Text>
              </View>
              <TouchableOpacity
                style={[styles.closeBtn, { backgroundColor: theme.borderSubtle }]}
                onPress={onClose}
              >
                <Feather name="x" size={16} color={theme.textMain} />
              </TouchableOpacity>
            </View>

            {/* Navigation Tabs */}
            <View style={[styles.tabsRow, { backgroundColor: theme.bgInput }]}>
              <TouchableOpacity
                style={[styles.tabBtn, activeTab === 'login' && [styles.activeTab, { backgroundColor: theme.bgCard }]]}
                onPress={() => {
                  setActiveTab('login');
                  setErrorMessage(null);
                }}
              >
                <Text style={[styles.tabText, { color: activeTab === 'login' ? theme.primary : theme.textMuted }]}>
                  Sign In
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabBtn, activeTab === 'otp' && [styles.activeTab, { backgroundColor: theme.bgCard }]]}
                onPress={() => {
                  setActiveTab('otp');
                  setErrorMessage(null);
                }}
              >
                <Text style={[styles.tabText, { color: activeTab === 'otp' ? theme.primary : theme.textMuted }]}>
                  Email OTP
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabBtn, activeTab === 'register' && [styles.activeTab, { backgroundColor: theme.bgCard }]]}
                onPress={() => {
                  setActiveTab('register');
                  setErrorMessage(null);
                }}
              >
                <Text style={[styles.tabText, { color: activeTab === 'register' ? theme.primary : theme.textMuted }]}>
                  Register
                </Text>
              </TouchableOpacity>
            </View>

            {/* Error Message Box */}
            {errorMessage && (
              <View style={[styles.errorBox, { backgroundColor: theme.dangerLight, borderColor: theme.danger }]}>
                <Feather name="alert-circle" size={14} color={theme.danger} />
                <Text style={[styles.errorText, { color: theme.danger }]}>{errorMessage}</Text>
              </View>
            )}

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.formContent}>
              {/* TAB 1: PASSWORD LOGIN */}
              {activeTab === 'login' && (
                <View style={styles.formSection}>
                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: theme.textMuted }]}>Username or Email</Text>
                    <View style={[styles.inputWrapper, { backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }]}>
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
                    <Text style={[styles.label, { color: theme.textMuted }]}>Password</Text>
                    <View style={[styles.inputWrapper, { backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }]}>
                      <Feather name="lock" size={15} color={theme.textMuted} />
                      <TextInput
                        style={[styles.input, { color: theme.textMain }]}
                        placeholder="Enter password"
                        placeholderTextColor={theme.textMuted}
                        secureTextEntry={!showPassword}
                        value={password}
                        onChangeText={setPassword}
                      />
                      <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                        <Feather name={showPassword ? 'eye-off' : 'eye'} size={15} color={theme.textMuted} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[styles.submitBtn, { backgroundColor: theme.primary }]}
                    onPress={handlePasswordLogin}
                    disabled={loading}
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
              {activeTab === 'otp' && (
                <View style={styles.formSection}>
                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: theme.textMuted }]}>Email Address</Text>
                    <View style={[styles.inputWrapper, { backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }]}>
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
                      style={[styles.submitBtn, { backgroundColor: theme.primary }]}
                      onPress={handleSendOtp}
                      disabled={loading}
                      activeOpacity={0.8}
                    >
                      {loading ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <Text style={styles.submitBtnText}>Send One-Time Code</Text>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <>
                      <View style={styles.inputGroup}>
                        <Text style={[styles.label, { color: theme.textMuted }]}>6-Digit Code</Text>
                        <View style={[styles.inputWrapper, { backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }]}>
                          <Feather name="key" size={15} color={theme.textMuted} />
                          <TextInput
                            style={[styles.input, { color: theme.textMain, letterSpacing: 4, fontWeight: '700' }]}
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
                        style={[styles.submitBtn, { backgroundColor: theme.primary }]}
                        onPress={handleVerifyOtp}
                        disabled={loading}
                        activeOpacity={0.8}
                      >
                        {loading ? (
                          <ActivityIndicator color="#ffffff" size="small" />
                        ) : (
                          <Text style={styles.submitBtnText}>Verify & Sign In</Text>
                        )}
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}

              {/* TAB 3: REGISTER */}
              {activeTab === 'register' && (
                <View style={styles.formSection}>
                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: theme.textMuted }]}>Full Name</Text>
                    <View style={[styles.inputWrapper, { backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }]}>
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
                    <Text style={[styles.label, { color: theme.textMuted }]}>Username</Text>
                    <View style={[styles.inputWrapper, { backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }]}>
                      <Feather name="at-sign" size={15} color={theme.textMuted} />
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
                    <Text style={[styles.label, { color: theme.textMuted }]}>Email Address</Text>
                    <View style={[styles.inputWrapper, { backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }]}>
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
                    <Text style={[styles.label, { color: theme.textMuted }]}>Password (min 6 characters)</Text>
                    <View style={[styles.inputWrapper, { backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }]}>
                      <Feather name="lock" size={15} color={theme.textMuted} />
                      <TextInput
                        style={[styles.input, { color: theme.textMain }]}
                        placeholder="Create strong password"
                        placeholderTextColor={theme.textMuted}
                        secureTextEntry={!showPassword}
                        value={regPassword}
                        onChangeText={setRegPassword}
                      />
                      <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                        <Feather name={showPassword ? 'eye-off' : 'eye'} size={15} color={theme.textMuted} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[styles.submitBtn, { backgroundColor: theme.primary }]}
                    onPress={handleRegister}
                    disabled={loading}
                    activeOpacity={0.8}
                  >
                    {loading ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text style={styles.submitBtnText}>Create Account</Text>
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
          </Pressable>
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
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    paddingHorizontal: 16,
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
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoIcon: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabsRow: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 3,
    marginTop: 12,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 9,
  },
  activeTab: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '500',
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
    fontWeight: '600',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
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
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  guestBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  guestBtnText: {
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
