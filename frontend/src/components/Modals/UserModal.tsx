import React, { useState, useEffect } from 'react';
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
}) => {
  const { mode, setMode, accent, setAccent, currentAccent } = useTheme();
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');

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
      setLoginIdentifier('');
      setLoginPassword('');
      setRegDisplayName('');
      setRegUsername('');
      setRegEmail('');
      setRegPassword('');
      setIsSubmitting(false);
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

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
          {/* CASE A: USER IS CURRENTLY LOGGED IN */}
          {currentUser ? (
            <div className="flex flex-col gap-4">
              {/* User Profile Card */}
              <div className="flex items-center gap-3 p-3 bg-(--border-subtle) border border-(--border-subtle) rounded-xl">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-lg shrink-0"
                  style={{ backgroundColor: currentUser.avatar_color || currentAccent.primary }}
                >
                  {currentUser.display_name.charAt(0).toUpperCase()}
                </div>
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
                        className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-3 text-xs placeholder-(--text-muted) outline-none"
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
                        className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-9 text-xs text-(--text-main) outline-none"
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
                        className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-3 text-xs placeholder-(--text-muted) outline-none"
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
                        className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-3 text-xs placeholder-(--text-muted) outline-none"
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
                        className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-3 text-xs placeholder-(--text-muted) outline-none"
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
                        className="w-full bg-(--border-subtle) border border-(--border-subtle) focus:border-primary-theme rounded-xl py-2 pl-9 pr-9 text-xs placeholder-(--text-muted) outline-none"
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

              {/* Theme Quick Preference Bar for Guests */}
              <div className="p-2.5 bg-(--border-subtle)/50 border border-(--border-subtle) rounded-xl flex items-center justify-between">
                <span className="text-[11px] text-(--text-muted) flex items-center gap-1.5 font-medium">
                  <LuPalette size={13} className="text-primary-theme" /> Theme Accent:
                </span>
                <div className="flex items-center gap-1.5">
                  {(['blue', 'purple', 'emerald', 'rose', 'amber'] as AccentColor[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`w-4 h-4 rounded-full cursor-pointer ${accent === key ? 'scale-125 ring-2 ring-white/50' : 'opacity-70 hover:opacity-100'
                        }`}
                      style={{ backgroundColor: ACCENT_PALETTES[key].primary }}
                      onClick={() => setAccent(key)}
                      title={ACCENT_PALETTES[key].label}
                    />
                  ))}
                </div>
              </div>

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
