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
} from 'react-icons/lu';
import { useTheme, ACCENT_PALETTES, type AccentColor } from '../../context/ThemeContext';
import type { User } from '../../types';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  initialTab?: 'login' | 'register';
  onLogin: (usernameOrEmail: string, password: string) => Promise<void>;
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

  // Edit Profile State
  const [editDisplayName, setEditDisplayName] = useState('');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState<string | null>(null);

  // Pending Avatar Staging State (Preview only until Save)
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [isAvatarRemoved, setIsAvatarRemoved] = useState(false);

  // Change Password State
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordSuccessMsg, setPasswordSuccessMsg] = useState<string | null>(null);

  // Login Form State
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

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setProfileSuccessMsg(null);
      setPasswordSuccessMsg(null);
      setLoginIdentifier('');
      setLoginPassword('');
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

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

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
          {/* Status Alerts */}
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

          {/* CASE A: USER IS CURRENTLY LOGGED IN */}
          {currentUser ? (
            <div className="flex flex-col gap-4">
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

              {/* Error Alert */}
              {errorMessage && (
                <div className="flex items-center gap-2 p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-500">
                  <LuCircleAlert size={15} className="shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* TAB 1: LOGIN */}
              {activeTab === 'login' && (
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
                        className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-3 text-xs outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-(--text-main) font-medium">Password *</label>
                    <div className="relative flex items-center">
                      <LuLock size={15} className="absolute left-3 text-(--text-muted) pointer-events-none" />
                      <input
                        type={showLoginPassword ? 'text' : 'password'}
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="Enter password"
                        required
                        autoComplete="current-password"
                        className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-9 text-xs outline-none"
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
                    className="mt-1 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-theme hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <LuLoader size={15} className="icon-spin" /> Authenticating...
                      </>
                    ) : (
                      <>
                        <LuLogIn size={15} /> Sign In to Account
                      </>
                    )}
                  </button>
                </form>
              )}

              {/* TAB 2: REGISTER */}
              {activeTab === 'register' && (
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
