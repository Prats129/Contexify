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
  LuInfo,
  LuLoader,
  LuUserCheck,
} from 'react-icons/lu';
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
      className="fixed inset-0 z-[2000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl shadow-black/80 flex flex-col overflow-hidden animate-[popoverIn_0.2s_cubic-bezier(0.16,1,0.3,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2 text-blue-400 font-bold text-base">
            <LuShieldCheck size={20} />
            <h3 className="text-gray-100 text-sm font-semibold">
              {currentUser ? 'Account Profile' : 'Contexify AI Authentication'}
            </h3>
          </div>
          <button
            type="button"
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            onClick={onClose}
            title="Close"
          >
            <LuX size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          {/* CASE A: USER IS CURRENTLY LOGGED IN */}
          {currentUser ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-lg shrink-0"
                  style={{ backgroundColor: currentUser.avatar_color || '#3B82F6' }}
                >
                  {currentUser.display_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col min-w-0">
                  <h4 className="text-sm font-bold text-gray-100 truncate">
                    {currentUser.display_name}
                  </h4>
                  <span className="text-xs text-gray-400">@{currentUser.username}</span>
                  <span className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                    <LuMail size={12} /> {currentUser.email}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300">
                <LuInfo size={16} className="shrink-0 mt-0.5" />
                <span>
                  You are currently logged in. To switch accounts or create a new account, please log out first.
                </span>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-300 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Are you sure you want to log out of your account?'
                      )
                    ) {
                      onLogout();
                      onClose();
                    }
                  }}
                >
                  <LuLogOut size={15} /> Log Out of Account
                </button>
                <button
                  type="button"
                  className="w-full py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
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
              <div className="grid grid-cols-2 p-1 bg-white/5 border border-white/10 rounded-xl gap-1">
                <button
                  type="button"
                  className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    activeTab === 'login'
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                      : 'text-gray-400 hover:text-white'
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
                  className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    activeTab === 'register'
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                      : 'text-gray-400 hover:text-white'
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
                <div className="flex items-center gap-2 p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400">
                  <LuCircleAlert size={15} className="shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* TAB 1: LOGIN */}
              {activeTab === 'login' && (
                <form onSubmit={handleLoginSubmit} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-300 font-medium">Username or Email *</label>
                    <div className="relative flex items-center">
                      <LuUser size={15} className="absolute left-3 text-gray-400 pointer-events-none" />
                      <input
                        type="text"
                        value={loginIdentifier}
                        onChange={(e) => setLoginIdentifier(e.target.value)}
                        placeholder="Enter username or email"
                        required
                        autoComplete="username"
                        className="w-full bg-white/5 border border-white/10 focus:border-blue-500 rounded-xl py-2 pl-9 pr-3 text-xs text-white placeholder-gray-500 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-300 font-medium">Password *</label>
                    <div className="relative flex items-center">
                      <LuLock size={15} className="absolute left-3 text-gray-400 pointer-events-none" />
                      <input
                        type={showLoginPassword ? 'text' : 'password'}
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="Enter password"
                        required
                        autoComplete="current-password"
                        className="w-full bg-white/5 border border-white/10 focus:border-blue-500 rounded-xl py-2 pl-9 pr-9 text-xs text-white placeholder-gray-500 outline-none transition-colors"
                      />
                      <button
                        type="button"
                        className="absolute right-3 text-gray-400 hover:text-white cursor-pointer"
                        onClick={() => setShowLoginPassword((prev) => !prev)}
                        title={showLoginPassword ? 'Hide password' : 'Show password'}
                      >
                        {showLoginPassword ? <LuEyeOff size={14} /> : <LuEye size={14} />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="mt-1 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-md shadow-blue-500/20 transition-all cursor-pointer"
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
                    <label className="text-xs text-gray-300 font-medium">Full Name *</label>
                    <div className="relative flex items-center">
                      <LuIdCard size={15} className="absolute left-3 text-gray-400 pointer-events-none" />
                      <input
                        type="text"
                        value={regDisplayName}
                        onChange={(e) => setRegDisplayName(e.target.value)}
                        placeholder="Enter full name"
                        required
                        autoComplete="name"
                        className="w-full bg-white/5 border border-white/10 focus:border-blue-500 rounded-xl py-2 pl-9 pr-3 text-xs text-white placeholder-gray-500 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-300 font-medium">Username *</label>
                    <div className="relative flex items-center">
                      <LuAtSign size={15} className="absolute left-3 text-gray-400 pointer-events-none" />
                      <input
                        type="text"
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value)}
                        placeholder="Choose unique username (e.g. alex_smith)"
                        required
                        autoComplete="username"
                        className="w-full bg-white/5 border border-white/10 focus:border-blue-500 rounded-xl py-2 pl-9 pr-3 text-xs text-white placeholder-gray-500 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-300 font-medium">Email Address *</label>
                    <div className="relative flex items-center">
                      <LuMail size={15} className="absolute left-3 text-gray-400 pointer-events-none" />
                      <input
                        type="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="Enter email"
                        required
                        autoComplete="email"
                        className="w-full bg-white/5 border border-white/10 focus:border-blue-500 rounded-xl py-2 pl-9 pr-3 text-xs text-white placeholder-gray-500 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-300 font-medium">Password * (min 6 chars)</label>
                    <div className="relative flex items-center">
                      <LuLock size={15} className="absolute left-3 text-gray-400 pointer-events-none" />
                      <input
                        type={showRegPassword ? 'text' : 'password'}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="Create secure password"
                        required
                        minLength={6}
                        autoComplete="new-password"
                        className="w-full bg-white/5 border border-white/10 focus:border-blue-500 rounded-xl py-2 pl-9 pr-9 text-xs text-white placeholder-gray-500 outline-none transition-colors"
                      />
                      <button
                        type="button"
                        className="absolute right-3 text-gray-400 hover:text-white cursor-pointer"
                        onClick={() => setShowRegPassword((prev) => !prev)}
                        title={showRegPassword ? 'Hide password' : 'Show password'}
                      >
                        {showRegPassword ? <LuEyeOff size={14} /> : <LuEye size={14} />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="mt-1 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-md shadow-blue-500/20 transition-all cursor-pointer"
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
              <div className="pt-1 border-t border-white/10 text-center">
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
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
