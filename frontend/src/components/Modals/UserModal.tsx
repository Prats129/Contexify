import React, { useState, useEffect, useRef } from 'react';
import {
  LuShieldCheck,
  LuX,
  LuLogIn,
  LuUserPlus,
  LuLogOut,
  LuUser,
  LuLock,
  LuEye,
  LuEyeOff,
  LuMail,
  LuIdCard,
  LuAtSign,
  LuCircleAlert,
  LuLoader,
  LuUserCheck,
  LuSun,
  LuMoon,
  LuPalette,
  LuCheck,
  LuCamera,
  LuTrash2,
  LuMailCheck,
  LuArrowLeft,
  LuRefreshCw,
  LuKeyRound,
} from 'react-icons/lu';
import { useTheme, ACCENT_PALETTES, type AccentColor } from '../../context/ThemeContext';
import type { User, SendOtpResponse, GoogleAuthRequest } from '../../types';

const GoogleIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" className="shrink-0">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
    />
  </svg>
);

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  initialTab?: 'login' | 'register';
  onLogin?: (usernameOrEmail: string, password: string) => Promise<void>;
  onLoginWithOtp: (usernameOrEmail: string, otp: string) => Promise<void>;
  onGoogleAuth?: (data: GoogleAuthRequest) => Promise<void>;
  onSendOtp: (usernameOrEmail: string) => Promise<SendOtpResponse>;
  onSendPasswordResetOtp?: (usernameOrEmail: string) => Promise<SendOtpResponse>;
  onResetPasswordWithOtp?: (
    usernameOrEmail: string,
    otp: string,
    newPassword: string
  ) => Promise<{ message: string }>;
  onRegister: (
    displayName: string,
    username: string,
    email: string,
    password: string
  ) => Promise<void>;
  onLogout: () => void;
  onContinueAsGuest: () => void;
  onUpdateProfile?: (displayName: string, avatarColor: string) => Promise<void>;
  onChangePassword?: (oldPassword: string, newPassword: string) => Promise<void>;
  onUploadAvatar?: (file: File) => Promise<void>;
  onDeleteAvatar?: () => Promise<void>;
}

export const UserModal: React.FC<UserModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  initialTab = 'login',
  onLogin,
  onLoginWithOtp,
  onGoogleAuth,
  onSendOtp,
  onSendPasswordResetOtp,
  onResetPasswordWithOtp,
  onRegister,
  onLogout,
  onContinueAsGuest,
  onUpdateProfile,
  onChangePassword,
  onUploadAvatar,
  onDeleteAvatar,
}) => {
  const { mode, setMode, accent, setAccent, currentAccent } = useTheme();
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);
  const resetOtpInputRef = useRef<HTMLInputElement>(null);

  // Edit Profile State
  const [editDisplayName, setEditDisplayName] = useState('');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState<string | null>(null);

  // Pending Avatar Staging State (Preview only until Save)
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [isAvatarRemoved, setIsAvatarRemoved] = useState(false);

  // Change Password State (Logged in)
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordSuccessMsg, setPasswordSuccessMsg] = useState<string | null>(null);

  // Login & OTP State
  const [loginMethod, setLoginMethod] = useState<'password' | 'otp' | 'forgot_password'>('password');
  const [otpStep, setOtpStep] = useState<'request' | 'verify'>('request');
  const [otpCode, setOtpCode] = useState('');
  const [otpMaskedEmail, setOtpMaskedEmail] = useState('');
  const [resendCountdown, setResendCountdown] = useState(0);

  // Forgot & Reset Password State (Logged out)
  const [resetStep, setResetStep] = useState<'request' | 'verify_and_set'>('request');
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetNewPassword, setShowResetNewPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [resetMaskedEmail, setResetMaskedEmail] = useState('');
  const [authSuccessMsg, setAuthSuccessMsg] = useState<string | null>(null);

  // Password Login State
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register Form State
  const [regDisplayName, setRegDisplayName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Status & Error handling
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Resend Countdown Timer
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => {
      setResendCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setProfileSuccessMsg(null);
      setPasswordSuccessMsg(null);
      setAuthSuccessMsg(null);
      setLoginIdentifier('');
      setLoginPassword('');
      setLoginMethod('password');
      setOtpStep('request');
      setOtpCode('');
      setOtpMaskedEmail('');
      setResetStep('request');
      setResetIdentifier('');
      setResetOtp('');
      setResetNewPassword('');
      setResetConfirmPassword('');
      setShowResetNewPassword(false);
      setShowResetConfirmPassword(false);
      setResetMaskedEmail('');
      setResendCountdown(0);
      setRegDisplayName('');
      setRegUsername('');
      setRegEmail('');
      setRegPassword('');
      setOldPassword('');
      setNewPassword('');
      setIsSubmitting(false);
      setIsEditingProfile(false);
      setIsChangingPassword(false);
      setPendingAvatarFile(null);
      setAvatarPreviewUrl(null);
      setIsAvatarRemoved(false);
      if (currentUser) {
        setEditDisplayName(currentUser.display_name);
      }
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab, currentUser]);

  // Handle local photo file selection (preview only)
  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    e.target.value = '';
    setErrorMessage(null);
    setProfileSuccessMsg(null);

    const MAX_SIZE = 2 * 1024 * 1024; // 2MB
    if (file.size > MAX_SIZE) {
      setErrorMessage(`Selected image (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 2MB limit.`);
      return;
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type.toLowerCase()) && !/\.(png|jpg|jpeg|webp|gif)$/i.test(file.name)) {
      setErrorMessage('Invalid image format. Allowed formats: PNG, JPG, JPEG, WEBP, GIF.');
      return;
    }

    setPendingAvatarFile(file);
    setIsAvatarRemoved(false);
    const preview = URL.createObjectURL(file);
    setAvatarPreviewUrl(preview);
  };

  // Handle local photo removal (staging only)
  const handleRemovePhotoClick = () => {
    setPendingAvatarFile(null);
    setAvatarPreviewUrl(null);
    setIsAvatarRemoved(true);
  };

  // Cancel profile editing and discard pending changes
  const handleCancelEditing = () => {
    setIsEditingProfile(false);
    setPendingAvatarFile(null);
    setAvatarPreviewUrl(null);
    setIsAvatarRemoved(false);
    setErrorMessage(null);
    if (currentUser) {
      setEditDisplayName(currentUser.display_name);
    }
  };

  // Submit all profile changes together on Save
  const handleProfileUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setProfileSuccessMsg(null);
    if (!currentUser) return;

    const trimmedName = editDisplayName.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setErrorMessage('Display Name must be at least 2 characters.');
      return;
    }

    try {
      setIsSubmitting(true);

      // 1. Commit avatar upload or deletion if changed
      if (pendingAvatarFile && onUploadAvatar) {
        await onUploadAvatar(pendingAvatarFile);
      } else if (isAvatarRemoved && currentUser.avatar_url && onDeleteAvatar) {
        await onDeleteAvatar();
      }

      // 2. Commit display name & fallback color
      if (onUpdateProfile) {
        await onUpdateProfile(trimmedName, currentUser.avatar_color || currentAccent.primary);
      }

      setProfileSuccessMsg('Profile updated successfully!');
      setPendingAvatarFile(null);
      setAvatarPreviewUrl(null);
      setIsAvatarRemoved(false);
      setIsEditingProfile(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setPasswordSuccessMsg(null);
    if (!currentUser || !onChangePassword) return;

    if (!oldPassword) {
      setErrorMessage('Please enter your current password.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setErrorMessage('New password must be at least 6 characters.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onChangePassword(oldPassword, newPassword);
      setPasswordSuccessMsg('Password changed successfully!');
      setOldPassword('');
      setNewPassword('');
      setIsChangingPassword(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendOtpSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage(null);

    const identifier = loginIdentifier.trim();
    if (!identifier) {
      setErrorMessage('Please enter your email or username.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await onSendOtp(identifier);
      setOtpMaskedEmail(res.masked_email || res.email);
      setResendCountdown(res.cooldown_seconds || 60);
      setOtpStep('verify');
      setOtpCode('');
      setTimeout(() => otpInputRef.current?.focus(), 100);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const identifier = loginIdentifier.trim();
    const code = otpCode.trim();

    if (!identifier) {
      setErrorMessage('Account identifier is missing. Please enter your email or username.');
      setOtpStep('request');
      return;
    }

    if (!code || code.length !== 6) {
      setErrorMessage('Please enter the complete 6-digit verification code.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onLoginWithOtp(identifier, code);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendResetOtpSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage(null);
    setAuthSuccessMsg(null);

    const identifier = resetIdentifier.trim();
    if (!identifier) {
      setErrorMessage('Please enter your registered email or username.');
      return;
    }

    if (!onSendPasswordResetOtp) {
      setErrorMessage('Password reset service is not available.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await onSendPasswordResetOtp(identifier);
      setResetMaskedEmail(res.masked_email || res.email);
      setResendCountdown(res.cooldown_seconds || 30);
      setResetStep('verify_and_set');
      setResetOtp('');
      setResetNewPassword('');
      setResetConfirmPassword('');
      setTimeout(() => resetOtpInputRef.current?.focus(), 100);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setAuthSuccessMsg(null);

    const identifier = resetIdentifier.trim();
    const otp = resetOtp.trim();
    const newPwd = resetNewPassword;
    const confirmPwd = resetConfirmPassword;

    if (!identifier) {
      setErrorMessage('Account identifier is missing. Please start over.');
      setResetStep('request');
      return;
    }

    if (!otp || otp.length !== 6) {
      setErrorMessage('Please enter the complete 6-digit verification code.');
      return;
    }

    if (!newPwd || newPwd.length < 6) {
      setErrorMessage('New password must be at least 6 characters long.');
      return;
    }

    if (newPwd !== confirmPwd) {
      setErrorMessage('New passwords do not match. Please re-enter.');
      return;
    }

    if (!onResetPasswordWithOtp) {
      setErrorMessage('Password reset service is not available.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await onResetPasswordWithOtp(identifier, otp, newPwd);
      setAuthSuccessMsg(res.message || 'Password reset successfully! Please sign in with your new password.');
      setLoginIdentifier(identifier);
      setLoginPassword('');
      setLoginMethod('password');
      setResetStep('request');
      setResetOtp('');
      setResetNewPassword('');
      setResetConfirmPassword('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignInClick = async () => {
    setErrorMessage(null);
    setAuthSuccessMsg(null);

    if (!onGoogleAuth) {
      setErrorMessage('Google Sign-In is not configured.');
      return;
    }

    const clientId =
      (import.meta as unknown as { env?: { VITE_GOOGLE_CLIENT_ID?: string } }).env?.VITE_GOOGLE_CLIENT_ID || '';

    // Direct Centered Popup Window with explicit width & height
    if (clientId) {
      try {
        setIsSubmitting(true);
        const redirectUri = window.location.origin;
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent('openid email profile')}&prompt=select_account`;
        const width = 460;
        const height = 520;
        const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
        const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
        const popup = window.open(
          authUrl,
          'google_oauth_popup',
          `popup=1,width=${width},height=${height},left=${left},top=${top},toolbar=0,menubar=0,location=0,status=0,scrollbars=1,resizable=1`
        );

        if (popup) {
          const interval = setInterval(async () => {
            try {
              if (!popup || popup.closed) {
                clearInterval(interval);
                setIsSubmitting(false);
                return;
              }
              if (popup.location.href.includes(window.location.origin)) {
                const hash = popup.location.hash;
                if (hash.includes('access_token=')) {
                  clearInterval(interval);
                  popup.close();
                  const params = new URLSearchParams(hash.replace('#', ''));
                  const accessToken = params.get('access_token');
                  if (accessToken) {
                    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                      headers: { Authorization: `Bearer ${accessToken}` },
                    });
                    if (res.ok) {
                      const info = await res.json();
                      await onGoogleAuth({
                        email: info.email,
                        name: info.name,
                        picture: info.picture,
                        google_id: info.sub,
                      });
                      onClose();
                    }
                  }
                }
              }
            } catch {
              // Cross-origin wait until redirected back to localhost
            }
          }, 400);
          return;
        }
      } catch (err) {
        console.warn('Popup window error:', err);
      } finally {
        setIsSubmitting(false);
      }
    }

    setIsSubmitting(false);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!onLogin) {
      setErrorMessage('Password login is not configured. Please use Email OTP.');
      return;
    }

    const identifier = loginIdentifier.trim();
    const pwd = loginPassword;

    if (!identifier || !pwd) {
      setErrorMessage('Please enter your username/email and password.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onLogin(identifier, pwd);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const displayName = regDisplayName.trim();
    const username = regUsername.trim().toLowerCase();
    const email = regEmail.trim().toLowerCase();
    const password = regPassword;

    if (!displayName || displayName.length < 2) {
      setErrorMessage('Display Name must be at least 2 characters.');
      return;
    }

    if (!username || username.length < 3) {
      setErrorMessage('Username must be at least 3 characters.');
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setErrorMessage('Username may only contain letters, numbers, and underscores.');
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    if (!password || password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onRegister(displayName, username, email, password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-2000 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        className="bg-(--bg-card) border border-(--border-hover) rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden animate-[popoverIn_0.2s_cubic-bezier(0.16,1,0.3,1)] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-(--border-subtle) sticky top-0 bg-(--bg-card)/90 backdrop-blur-md z-10">
          <div className="flex items-center gap-2 text-primary-theme font-bold text-base">
            <LuShieldCheck size={20} />
            <h3 className="text-(--text-main) text-sm font-semibold">
              {currentUser ? 'Account & Preferences' : 'Contexify AI Authentication'}
            </h3>
          </div>
          <button
            type="button"
            className="w-7 h-7 rounded-lg bg-(--border-subtle) hover:bg-(--border-hover) text-(--text-muted) hover:text-(--text-main) flex items-center justify-center cursor-pointer"
            onClick={onClose}
            title="Close"
          >
            <LuX size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-5">
          {/* CASE A: USER IS CURRENTLY LOGGED IN */}
          {currentUser ? (
            <div className="flex flex-col gap-4">
              {/* Status Alerts for Logged-in User */}
              {errorMessage && (
                <div className="flex items-center gap-2 p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-500">
                  <LuCircleAlert size={15} className="shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
              {profileSuccessMsg && (
                <div className="flex items-center gap-2 p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-500">
                  <LuCheck size={15} className="shrink-0" />
                  <span>{profileSuccessMsg}</span>
                </div>
              )}
              {passwordSuccessMsg && (
                <div className="flex items-center gap-2 p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-500">
                  <LuCheck size={15} className="shrink-0" />
                  <span>{passwordSuccessMsg}</span>
                </div>
              )}
              {/* User Profile Card */}
              <div className="flex items-center justify-between p-3 bg-(--border-subtle) border border-(--border-subtle) rounded-xl">
                <div className="flex items-center gap-3 min-w-0">
                  {currentUser.avatar_url ? (
                    <img
                      src={currentUser.avatar_url}
                      alt={currentUser.display_name}
                      className="w-12 h-12 rounded-full object-cover shrink-0 border border-(--border-subtle)"
                    />
                  ) : (
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-lg shrink-0"
                      style={{ backgroundColor: currentUser.avatar_color || currentAccent.primary }}
                    >
                      {currentUser.display_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex flex-col min-w-0">
                    <h4 className="text-sm font-bold text-(--text-main) truncate">
                      {currentUser.display_name}
                    </h4>
                    <span className="text-xs text-(--text-muted)">@{currentUser.username}</span>
                    <span className="text-xs text-(--text-muted) flex items-center gap-1 mt-0.5">
                      <LuMail size={12} /> {currentUser.email}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="px-2.5 py-1 text-xs font-medium text-primary-theme bg-primary-light-theme hover:opacity-80 rounded-lg border border-primary-theme/30 cursor-pointer shrink-0"
                  onClick={isEditingProfile ? handleCancelEditing : () => {
                    setIsEditingProfile(true);
                    setIsChangingPassword(false);
                    setErrorMessage(null);
                  }}
                >
                  {isEditingProfile ? 'Cancel' : 'Edit'}
                </button>
              </div>

              {/* Edit Profile Form Sub-panel */}
              {isEditingProfile && (
                <form onSubmit={handleProfileUpdateSubmit} className="flex flex-col gap-3.5 p-3.5 bg-(--border-subtle)/50 border border-primary-theme/30 rounded-xl">
                  <span className="text-xs font-semibold text-(--text-main)">Edit Profile Details</span>

                  {/* Profile Picture Upload & Live Preview */}
                  <div className="flex flex-col gap-2 p-2.5 bg-(--bg-card) border border-(--border-subtle) rounded-xl">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-(--text-muted)">Profile Photo</label>
                      <span className="text-[10px] text-(--text-muted)">Max 2MB</span>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* Live Circular Preview */}
                      <div className="relative shrink-0">
                        {(!isAvatarRemoved && (avatarPreviewUrl || currentUser.avatar_url)) ? (
                          <img
                            src={avatarPreviewUrl || currentUser.avatar_url || ''}
                            alt="Avatar Preview"
                            className="w-12 h-12 rounded-full object-cover border border-(--border-subtle) shadow-sm"
                          />
                        ) : (
                          <div
                            className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-base shadow-sm shrink-0"
                            style={{ backgroundColor: currentUser.avatar_color || currentAccent.primary }}
                          >
                            {editDisplayName.charAt(0).toUpperCase() || 'U'}
                          </div>
                        )}
                        {pendingAvatarFile && (
                          <span className="absolute -bottom-1 -right-1 text-[9px] bg-primary-theme text-white px-1.5 py-0.2 rounded-full font-bold shadow">
                            New
                          </span>
                        )}
                      </div>

                      {/* Photo Actions */}
                      <div className="flex flex-col gap-1">
                        <input
                          type="file"
                          ref={avatarFileInputRef}
                          accept=".png,.jpg,.jpeg,.webp,.gif,image/*"
                          onChange={handleAvatarFileChange}
                          hidden
                        />
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => avatarFileInputRef.current?.click()}
                            className="flex items-center gap-1 px-2.5 py-1 bg-(--border-subtle) hover:bg-(--border-hover) border border-(--border-subtle) text-(--text-main) text-xs rounded-lg cursor-pointer transition-colors"
                          >
                            <LuCamera size={13} />
                            <span>{(avatarPreviewUrl || (currentUser.avatar_url && !isAvatarRemoved)) ? 'Change Photo' : 'Upload Photo'}</span>
                          </button>

                          {(avatarPreviewUrl || (currentUser.avatar_url && !isAvatarRemoved)) && (
                            <button
                              type="button"
                              onClick={handleRemovePhotoClick}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 rounded-lg cursor-pointer transition-colors"
                              title="Remove photo"
                            >
                              <LuTrash2 size={13} />
                              <span>Remove</span>
                            </button>
                          )}
                        </div>
                        <span className="text-[10px] text-(--text-muted)">
                          {pendingAvatarFile ? `Selected: ${pendingAvatarFile.name}` : 'PNG, JPG, WEBP or GIF'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-(--text-muted)">Display Name</label>
                    <input
                      type="text"
                      value={editDisplayName}
                      onChange={(e) => setEditDisplayName(e.target.value)}
                      required
                      className="bg-(--bg-card) border border-(--border-subtle) focus:border-primary-theme rounded-lg py-1.5 px-3 text-xs outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="mt-1 py-1.5 px-3 bg-primary-theme text-white text-xs font-semibold rounded-lg hover:opacity-90 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {isSubmitting && <LuLoader className="icon-spin" size={13} />}
                    <span>{isSubmitting ? 'Saving Profile...' : 'Save Profile Changes'}</span>
                  </button>
                </form>
              )}

              {/* Change Password Sub-panel */}
              <div className="flex flex-col gap-2 p-3.5 bg-(--border-subtle)/30 border border-(--border-subtle) rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-(--text-main)">
                    <LuLock size={14} className="text-primary-theme" />
                    <span>Security & Password</span>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-primary-theme hover:underline cursor-pointer"
                    onClick={() => {
                      setIsChangingPassword((prev) => !prev);
                      setIsEditingProfile(false);
                      setErrorMessage(null);
                    }}
                  >
                    {isChangingPassword ? 'Cancel' : 'Change Password'}
                  </button>
                </div>

                {isChangingPassword && (
                  <form onSubmit={handlePasswordChangeSubmit} className="flex flex-col gap-2.5 pt-2">
                    <div className="relative flex items-center">
                      <input
                        type={showOldPassword ? 'text' : 'password'}
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        placeholder="Current password"
                        required
                        className="w-full bg-(--bg-card) border border-(--border-subtle) focus:border-primary-theme rounded-lg py-1.5 px-3 pr-8 text-xs outline-none"
                      />
                      <button
                        type="button"
                        className="absolute right-2.5 text-(--text-muted)"
                        onClick={() => setShowOldPassword((prev) => !prev)}
                      >
                        {showOldPassword ? <LuEyeOff size={13} /> : <LuEye size={13} />}
                      </button>
                    </div>

                    <div className="relative flex items-center">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New password (min 6 chars)"
                        required
                        minLength={6}
                        className="w-full bg-(--bg-card) border border-(--border-subtle) focus:border-primary-theme rounded-lg py-1.5 px-3 pr-8 text-xs outline-none"
                      />
                      <button
                        type="button"
                        className="absolute right-2.5 text-(--text-muted)"
                        onClick={() => setShowNewPassword((prev) => !prev)}
                      >
                        {showNewPassword ? <LuEyeOff size={13} /> : <LuEye size={13} />}
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="py-1.5 px-3 bg-primary-theme text-white text-xs font-semibold rounded-lg hover:opacity-90 cursor-pointer disabled:opacity-50"
                    >
                      {isSubmitting ? 'Updating Password...' : 'Update Password'}
                    </button>
                  </form>
                )}
              </div>

              {/* Theme & Appearance Section */}
              <div className="flex flex-col gap-3 p-4 bg-(--border-subtle)/40 border border-(--border-subtle) rounded-xl">
                <div className="flex items-center gap-2 text-xs font-semibold text-(--text-main)">
                  <LuPalette size={15} className="text-primary-theme" />
                  <span>Appearance & Theme Preferences</span>
                </div>

                {/* Theme Mode Toggle (Light vs Dark) */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium text-(--text-muted)">Theme Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-medium cursor-pointer ${mode === 'dark'
                        ? 'bg-primary-light-theme border-primary-theme text-primary-theme font-semibold'
                        : 'bg-(--border-subtle) border-(--border-subtle) text-(--text-main) hover:bg-(--border-hover)'
                        }`}
                      onClick={() => setMode('dark')}
                    >
                      <LuMoon size={14} /> Dark Mode
                    </button>
                    <button
                      type="button"
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-medium cursor-pointer ${mode === 'light'
                        ? 'bg-primary-light-theme border-primary-theme text-primary-theme font-semibold'
                        : 'bg-(--border-subtle) border-(--border-subtle) text-(--text-main) hover:bg-(--border-hover)'
                        }`}
                      onClick={() => setMode('light')}
                    >
                      <LuSun size={14} /> Light Mode
                    </button>
                  </div>
                </div>

                {/* Accent Color Palette Selector */}
                <div className="flex flex-col gap-1.5 mt-1">
                  <label className="text-[11px] font-medium text-(--text-muted)">
                    Accent Color ({currentAccent.label})
                  </label>
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                    {(Object.keys(ACCENT_PALETTES) as AccentColor[]).map((key) => {
                      const pal = ACCENT_PALETTES[key];
                      const isSelected = accent === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`group relative flex flex-col items-center justify-center p-2 rounded-xl border cursor-pointer ${isSelected
                            ? 'border-primary-theme bg-primary-light-theme scale-105'
                            : 'border-(--border-subtle) bg-(--border-subtle) hover:border-(--border-hover)'
                            }`}
                          onClick={() => setAccent(key)}
                          title={pal.label}
                        >
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center text-white shadow-sm"
                            style={{ backgroundColor: pal.primary }}
                          >
                            {isSelected && <LuCheck size={11} />}
                          </div>
                          <span className="text-[10px] text-(--text-muted) mt-1 truncate max-w-10">
                            {pal.label.split(' ')[0]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-500 rounded-xl text-xs font-semibold cursor-pointer"
                  onClick={() => {
                    if (window.confirm('Are you sure you want to log out of your account?')) {
                      onLogout();
                      onClose();
                    }
                  }}
                >
                  <LuLogOut size={15} /> Log Out of Account
                </button>
                <button
                  type="button"
                  className="w-full py-2 text-xs text-(--text-muted) hover:text-(--text-main) cursor-pointer"
                  onClick={onClose}
                >
                  Back to Workspace
                </button>
              </div>
            </div>
          ) : (

            /* CASE B: GUEST / NOT LOGGED IN */
            <>
              {/* Tab Switcher */}
              <div className="grid grid-cols-2 p-1 bg-(--border-subtle) border border-(--border-subtle) rounded-xl gap-1">
                <button
                  type="button"
                  className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${activeTab === 'login'
                    ? 'bg-primary-theme text-white'
                    : 'text-(--text-muted) hover:text-(--text-main)'
                    }`}
                  onClick={() => {
                    setActiveTab('login');
                    setErrorMessage(null);
                  }}
                >
                  <LuLogIn size={14} /> Sign In
                </button>
                <button
                  type="button"
                  className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${activeTab === 'register'
                    ? 'bg-primary-theme text-white'
                    : 'text-(--text-muted) hover:text-(--text-main)'
                    }`}
                  onClick={() => {
                    setActiveTab('register');
                    setErrorMessage(null);
                  }}
                >
                  <LuUserPlus size={14} /> Create Account
                </button>
              </div>

              {/* Status Alerts for Logged-out Users */}
              {authSuccessMsg && (
                <div className="flex items-center gap-2 p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-500">
                  <LuCheck size={15} className="shrink-0" />
                  <span>{authSuccessMsg}</span>
                </div>
              )}
              {errorMessage && (
                <div className="flex items-center gap-2 p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-500">
                  <LuCircleAlert size={15} className="shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* TAB 1: LOGIN */}
              {activeTab === 'login' && (
                <>
                  {loginMethod === 'password' ? (
                    /* PRIMARY METHOD: PASSWORD LOGIN */
                    <div className="flex flex-col gap-3">
                      {/* Google One-Click Sign In */}
                      <button
                        type="button"
                        onClick={handleGoogleSignInClick}
                        disabled={isSubmitting}
                        className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 bg-(--border-subtle) hover:bg-(--border-hover) border border-(--border-subtle) text-(--text-main) rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-sm"
                      >
                        <GoogleIcon />
                        <span>Continue with Google</span>
                      </button>

                      <div className="flex items-center gap-2 my-0.5">
                        <div className="h-px bg-(--border-subtle) flex-1" />
                        <span className="text-[10px] uppercase font-semibold text-(--text-muted) tracking-wider">or with credentials</span>
                        <div className="h-px bg-(--border-subtle) flex-1" />
                      </div>

                      <form onSubmit={handleLoginSubmit} className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-(--text-main) font-medium">Username or Email *</label>
                          <div className="relative flex items-center">
                            <LuUser size={15} className="absolute left-3 text-(--text-muted) pointer-events-none" />
                            <input
                              type="text"
                              value={loginIdentifier}
                              onChange={(e) => setLoginIdentifier(e.target.value)}
                              placeholder="Enter username or email"
                              required
                              autoComplete="username"
                              className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-3 text-xs outline-none transition-colors"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between">
                            <label className="text-xs text-(--text-main) font-medium">Password *</label>
                            <button
                              type="button"
                              className="text-[11px] text-primary-theme hover:underline cursor-pointer"
                              onClick={() => {
                                setLoginMethod('forgot_password');
                                setResetStep('request');
                                setResetIdentifier(loginIdentifier);
                                setErrorMessage(null);
                                setAuthSuccessMsg(null);
                              }}
                            >
                              Forgot Password?
                            </button>
                          </div>
                          <div className="relative flex items-center">
                            <LuLock size={15} className="absolute left-3 text-(--text-muted) pointer-events-none" />
                            <input
                              type={showLoginPassword ? 'text' : 'password'}
                              value={loginPassword}
                              onChange={(e) => setLoginPassword(e.target.value)}
                              placeholder="Enter password"
                              required
                              autoComplete="current-password"
                              className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-9 text-xs outline-none transition-colors"
                            />
                            <button
                              type="button"
                              className="absolute right-3 text-(--text-muted) hover:text-(--text-main) cursor-pointer"
                              onClick={() => setShowLoginPassword((prev) => !prev)}
                              title={showLoginPassword ? 'Hide password' : 'Show password'}
                            >
                              {showLoginPassword ? <LuEyeOff size={14} /> : <LuEye size={14} />}
                            </button>
                          </div>
                        </div>

                        <button
                          type="submit"
                          className="mt-1 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-theme hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-sm"
                          disabled={isSubmitting}
                        >
                          {isSubmitting ? (
                            <>
                              <LuLoader size={15} className="icon-spin" /> Signing In...
                            </>
                          ) : (
                            <>
                              <LuLogIn size={15} /> Sign In to Account
                            </>
                          )}
                        </button>

                        <div className="flex items-center gap-2 my-0.5">
                          <div className="h-px bg-(--border-subtle) flex-1" />
                          <span className="text-[10px] uppercase font-semibold text-(--text-muted) tracking-wider">or</span>
                          <div className="h-px bg-(--border-subtle) flex-1" />
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setLoginMethod('otp');
                            setOtpStep('request');
                            setErrorMessage(null);
                            setAuthSuccessMsg(null);
                          }}
                          className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-(--border-subtle)/70 hover:bg-(--border-subtle) border border-(--border-subtle) text-(--text-main) rounded-xl text-xs font-medium cursor-pointer transition-all"
                        >
                          <LuMail size={14} className="text-primary-theme" /> Sign In with Email OTP
                        </button>
                      </form>
                    </div>
                  ) : loginMethod === 'otp' ? (
                    /* SECONDARY METHOD: EMAIL OTP */
                    otpStep === 'request' ? (
                      /* STEP 1: REQUEST OTP */
                      <form onSubmit={handleSendOtpSubmit} className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-(--text-main) flex items-center gap-1.5">
                            <LuMail size={14} className="text-primary-theme" /> Email OTP Sign In
                          </span>
                          <button
                            type="button"
                            className="text-[11px] text-primary-theme hover:underline cursor-pointer flex items-center gap-1"
                            onClick={() => {
                              setLoginMethod('password');
                              setErrorMessage(null);
                              setAuthSuccessMsg(null);
                            }}
                          >
                            <LuLock size={12} /> Use Password
                          </button>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-(--text-main) font-medium">Username or Email *</label>
                          <div className="relative flex items-center">
                            <LuMail size={15} className="absolute left-3 text-(--text-muted) pointer-events-none" />
                            <input
                              type="text"
                              value={loginIdentifier}
                              onChange={(e) => setLoginIdentifier(e.target.value)}
                              placeholder="Enter registered email or username"
                              required
                              autoComplete="username email"
                              autoFocus
                              className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-3 text-xs outline-none transition-colors"
                            />
                          </div>
                          <p className="text-[11px] text-(--text-muted) mt-0.5">
                            A 6-digit verification code will be sent to your registered email.
                          </p>
                        </div>

                        <button
                          type="submit"
                          className="mt-1 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-theme hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-sm"
                          disabled={isSubmitting || !loginIdentifier.trim()}
                        >
                          {isSubmitting ? (
                            <>
                              <LuLoader size={15} className="icon-spin" /> Sending Code...
                            </>
                          ) : (
                            <>
                              <LuMail size={15} /> Send Login Code
                            </>
                          )}
                        </button>
                      </form>
                    ) : (
                      /* STEP 2: VERIFY OTP */
                      <form onSubmit={handleVerifyOtpSubmit} className="flex flex-col gap-3">
                        <div className="bg-(--border-subtle)/60 border border-(--border-subtle) rounded-xl p-3 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-primary-theme/15 text-primary-theme flex items-center justify-center shrink-0">
                              <LuMailCheck size={16} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[11px] text-(--text-muted)">Code sent to</div>
                              <div className="text-xs font-semibold text-(--text-main) truncate">{otpMaskedEmail}</div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setOtpStep('request');
                              setErrorMessage(null);
                            }}
                            className="text-[11px] font-medium text-primary-theme hover:underline shrink-0 cursor-pointer flex items-center gap-1"
                          >
                            <LuArrowLeft size={12} /> Change
                          </button>
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs text-(--text-main) font-medium text-center">
                            Enter 6-Digit Verification Code *
                          </label>
                          <div className="relative">
                            <input
                              ref={otpInputRef}
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={6}
                              value={otpCode}
                              onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                                setOtpCode(val);
                              }}
                              placeholder="000000"
                              required
                              autoComplete="one-time-code"
                              autoFocus
                              className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2.5 px-4 text-center font-mono text-xl tracking-[0.5em] outline-none font-bold text-(--text-main) transition-all"
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          className="mt-1 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-theme hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-sm"
                          disabled={isSubmitting || otpCode.length !== 6}
                        >
                          {isSubmitting ? (
                            <>
                              <LuLoader size={15} className="icon-spin" /> Verifying...
                            </>
                          ) : (
                            <>
                              <LuShieldCheck size={15} /> Verify & Sign In
                            </>
                          )}
                        </button>

                        <div className="flex items-center justify-between text-[11px] text-(--text-muted) pt-1 border-t border-(--border-subtle)/50">
                          {resendCountdown > 0 ? (
                            <span>Resend in {resendCountdown}s</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSendOtpSubmit()}
                              disabled={isSubmitting}
                              className="text-primary-theme hover:underline flex items-center gap-1 cursor-pointer font-medium"
                            >
                              <LuRefreshCw size={11} /> Resend code
                            </button>
                          )}

                          <button
                            type="button"
                            className="text-(--text-muted) hover:text-(--text-main) underline cursor-pointer"
                            onClick={() => {
                              setLoginMethod('password');
                              setErrorMessage(null);
                            }}
                          >
                            Password sign in
                          </button>
                        </div>
                      </form>
                    )
                  ) : (
                    /* TERTIARY METHOD: FORGOT & RESET PASSWORD */
                    resetStep === 'request' ? (
                      /* RESET STEP 1: REQUEST CODE */
                      <form onSubmit={handleSendResetOtpSubmit} className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-(--text-main) flex items-center gap-1.5">
                            <LuKeyRound size={14} className="text-primary-theme" /> Reset Password
                          </span>
                          <button
                            type="button"
                            className="text-[11px] text-primary-theme hover:underline cursor-pointer flex items-center gap-1"
                            onClick={() => {
                              setLoginMethod('password');
                              setErrorMessage(null);
                              setAuthSuccessMsg(null);
                            }}
                          >
                            <LuLock size={12} /> Back to Sign In
                          </button>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-(--text-main) font-medium">Registered Username or Email *</label>
                          <div className="relative flex items-center">
                            <LuMail size={15} className="absolute left-3 text-(--text-muted) pointer-events-none" />
                            <input
                              type="text"
                              value={resetIdentifier}
                              onChange={(e) => setResetIdentifier(e.target.value)}
                              placeholder="Enter username or email"
                              required
                              autoComplete="username email"
                              autoFocus
                              className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-3 text-xs outline-none transition-colors"
                            />
                          </div>
                          <p className="text-[11px] text-(--text-muted) mt-0.5">
                            We'll send a 6-digit password reset code to your registered email.
                          </p>
                        </div>

                        <button
                          type="submit"
                          className="mt-1 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-theme hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-sm"
                          disabled={isSubmitting || !resetIdentifier.trim()}
                        >
                          {isSubmitting ? (
                            <>
                              <LuLoader size={15} className="icon-spin" /> Sending Code...
                            </>
                          ) : (
                            <>
                              <LuKeyRound size={15} /> Send Reset Code
                            </>
                          )}
                        </button>
                      </form>
                    ) : (
                      /* RESET STEP 2: VERIFY CODE & SET NEW PASSWORD */
                      <form onSubmit={handleResetPasswordSubmit} className="flex flex-col gap-3">
                        <div className="bg-(--border-subtle)/60 border border-(--border-subtle) rounded-xl p-3 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-primary-theme/15 text-primary-theme flex items-center justify-center shrink-0">
                              <LuMailCheck size={16} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[11px] text-(--text-muted)">Reset code sent to</div>
                              <div className="text-xs font-semibold text-(--text-main) truncate">{resetMaskedEmail}</div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setResetStep('request');
                              setErrorMessage(null);
                            }}
                            className="text-[11px] font-medium text-primary-theme hover:underline shrink-0 cursor-pointer flex items-center gap-1"
                          >
                            <LuArrowLeft size={12} /> Change
                          </button>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-(--text-main) font-medium text-center">
                            Enter 6-Digit Reset Code *
                          </label>
                          <input
                            ref={resetOtpInputRef}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={6}
                            value={resetOtp}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                              setResetOtp(val);
                            }}
                            placeholder="000000"
                            required
                            autoComplete="one-time-code"
                            autoFocus
                            className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 px-4 text-center font-mono text-lg tracking-[0.4em] outline-none font-bold text-(--text-main) transition-all"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-(--text-main) font-medium">New Password * (min 6 characters)</label>
                          <div className="relative flex items-center">
                            <LuLock size={15} className="absolute left-3 text-(--text-muted) pointer-events-none" />
                            <input
                              type={showResetNewPassword ? 'text' : 'password'}
                              value={resetNewPassword}
                              onChange={(e) => setResetNewPassword(e.target.value)}
                              placeholder="Enter new password"
                              required
                              minLength={6}
                              autoComplete="new-password"
                              className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-9 text-xs outline-none transition-colors"
                            />
                            <button
                              type="button"
                              className="absolute right-3 text-(--text-muted) hover:text-(--text-main) cursor-pointer"
                              onClick={() => setShowResetNewPassword((prev) => !prev)}
                              title={showResetNewPassword ? 'Hide password' : 'Show password'}
                            >
                              {showResetNewPassword ? <LuEyeOff size={14} /> : <LuEye size={14} />}
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-(--text-main) font-medium">Confirm New Password *</label>
                          <div className="relative flex items-center">
                            <LuLock size={15} className="absolute left-3 text-(--text-muted) pointer-events-none" />
                            <input
                              type={showResetConfirmPassword ? 'text' : 'password'}
                              value={resetConfirmPassword}
                              onChange={(e) => setResetConfirmPassword(e.target.value)}
                              placeholder="Confirm new password"
                              required
                              minLength={6}
                              autoComplete="new-password"
                              className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-9 text-xs outline-none transition-colors"
                            />
                            <button
                              type="button"
                              className="absolute right-3 text-(--text-muted) hover:text-(--text-main) cursor-pointer"
                              onClick={() => setShowResetConfirmPassword((prev) => !prev)}
                              title={showResetConfirmPassword ? 'Hide password' : 'Show password'}
                            >
                              {showResetConfirmPassword ? <LuEyeOff size={14} /> : <LuEye size={14} />}
                            </button>
                          </div>
                        </div>

                        <button
                          type="submit"
                          className="mt-1 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-theme hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-sm"
                          disabled={isSubmitting || resetOtp.length !== 6 || resetNewPassword.length < 6}
                        >
                          {isSubmitting ? (
                            <>
                              <LuLoader size={15} className="icon-spin" /> Resetting Password...
                            </>
                          ) : (
                            <>
                              <LuKeyRound size={15} /> Reset Password
                            </>
                          )}
                        </button>

                        <div className="flex items-center justify-between text-[11px] text-(--text-muted) pt-1 border-t border-(--border-subtle)/50">
                          {resendCountdown > 0 ? (
                            <span>Resend in {resendCountdown}s</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSendResetOtpSubmit()}
                              disabled={isSubmitting}
                              className="text-primary-theme hover:underline flex items-center gap-1 cursor-pointer font-medium"
                            >
                              <LuRefreshCw size={11} /> Resend code
                            </button>
                          )}

                          <button
                            type="button"
                            className="text-(--text-muted) hover:text-(--text-main) underline cursor-pointer"
                            onClick={() => {
                              setLoginMethod('password');
                              setErrorMessage(null);
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )
                  )}
                </>
              )}

              {/* TAB 2: REGISTER */}
              {activeTab === 'register' && (
                <div className="flex flex-col gap-3">
                  {/* Google One-Click Sign Up */}
                  <button
                    type="button"
                    onClick={handleGoogleSignInClick}
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 bg-(--border-subtle) hover:bg-(--border-hover) border border-(--border-subtle) text-(--text-main) rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-sm"
                  >
                    <GoogleIcon />
                    <span>Sign up with Google</span>
                  </button>

                  <div className="flex items-center gap-2 my-0.5">
                    <div className="h-px bg-(--border-subtle) flex-1" />
                    <span className="text-[10px] uppercase font-semibold text-(--text-muted) tracking-wider">or register with email</span>
                    <div className="h-px bg-(--border-subtle) flex-1" />
                  </div>

                  <form onSubmit={handleRegisterSubmit} className="flex flex-col gap-2.5">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-(--text-main) font-medium">Full Name *</label>
                      <div className="relative flex items-center">
                        <LuIdCard size={15} className="absolute left-3 text-(--text-muted) pointer-events-none" />
                        <input
                          type="text"
                          value={regDisplayName}
                          onChange={(e) => setRegDisplayName(e.target.value)}
                          placeholder="Enter full name"
                          required
                          autoComplete="name"
                          className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-3 text-xs outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-(--text-main) font-medium">Username *</label>
                      <div className="relative flex items-center">
                        <LuAtSign size={15} className="absolute left-3 text-(--text-muted) pointer-events-none" />
                        <input
                          type="text"
                          value={regUsername}
                          onChange={(e) => setRegUsername(e.target.value)}
                          placeholder="Choose unique username (e.g. alex_smith)"
                          required
                          autoComplete="username"
                          className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-3 text-xs outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-(--text-main) font-medium">Email Address *</label>
                      <div className="relative flex items-center">
                        <LuMail size={15} className="absolute left-3 text-(--text-muted) pointer-events-none" />
                        <input
                          type="email"
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          placeholder="Enter email"
                          required
                          autoComplete="email"
                          className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-3 text-xs outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-(--text-main) font-medium">Password * (min 6 chars)</label>
                      <div className="relative flex items-center">
                        <LuLock size={15} className="absolute left-3 text-(--text-muted) pointer-events-none" />
                        <input
                          type={showRegPassword ? 'text' : 'password'}
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder="Create secure password"
                          required
                          minLength={6}
                          autoComplete="new-password"
                          className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-9 text-xs outline-none"
                        />
                        <button
                          type="button"
                          className="absolute right-3 text-(--text-muted) hover:text-(--text-main) cursor-pointer"
                          onClick={() => setShowRegPassword((prev) => !prev)}
                          title={showRegPassword ? 'Hide password' : 'Show password'}
                        >
                          {showRegPassword ? <LuEyeOff size={14} /> : <LuEye size={14} />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="mt-1 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-theme hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <LuLoader size={15} className="icon-spin" /> Creating Account...
                        </>
                      ) : (
                        <>
                          <LuUserPlus size={15} /> Create Account & Save History
                        </>
                      )}
                    </button>
                  </form>
                </div>
              )}

              {/* Guest Mode Action */}
              <div className="pt-1 border-t border-(--border-subtle) text-center">
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-(--text-muted) hover:text-(--text-main) cursor-pointer"
                  onClick={onContinueAsGuest}
                >
                  <LuUserCheck size={14} /> Continue as Guest (Ephemeral Mode)
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
