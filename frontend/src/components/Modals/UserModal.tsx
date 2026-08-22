import React, { useState, useEffect } from 'react';
import type { User } from '../../types';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  onLogin: (usernameOrEmail: string, password: string) => Promise<void>;
  onRegister: (
    displayName: string,
    username: string,
    email: string,
    password: string
  ) => Promise<void>;
  onContinueAsGuest: () => void;
}

export const UserModal: React.FC<UserModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onLogin,
  onRegister,
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
      // Default to register if no user logged in, or login
      setActiveTab('login');
    }
  }, [isOpen]);

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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card auth-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <i className="fa-solid fa-shield-halved"></i>
            <h3>{currentUser ? 'User Account' : 'Contexify AI Authentication'}</h3>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose} title="Close">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="modal-body">
          {/* Active User Card if already signed in */}
          {currentUser && (
            <div className="current-user-banner">
              <div className="user-avatar" style={{ backgroundColor: currentUser.avatar_color || '#3B82F6' }}>
                {currentUser.display_name.charAt(0).toUpperCase()}
              </div>
              <div className="user-info">
                <span className="user-name">{currentUser.display_name}</span>
                <span className="user-email">@{currentUser.username} • {currentUser.email}</span>
              </div>
            </div>
          )}

          {/* Tab Switcher */}
          <div className="auth-tab-group">
            <button
              type="button"
              className={`auth-tab-btn ${activeTab === 'login' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('login');
                setErrorMessage(null);
              }}
            >
              <i className="fa-solid fa-right-to-bracket"></i> Sign In
            </button>
            <button
              type="button"
              className={`auth-tab-btn ${activeTab === 'register' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('register');
                setErrorMessage(null);
              }}
            >
              <i className="fa-solid fa-user-plus"></i> Create Account
            </button>
          </div>

          {/* Error Alert */}
          {errorMessage && (
            <div className="auth-error-banner">
              <i className="fa-solid fa-circle-exclamation"></i>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* TAB 1: LOGIN */}
          {activeTab === 'login' && (
            <form onSubmit={handleLoginSubmit} className="user-login-form">
              <div className="form-group">
                <label htmlFor="loginIdentifier">Username or Email *</label>
                <div className="input-with-icon">
                  <i className="fa-solid fa-user input-icon"></i>
                  <input
                    type="text"
                    id="loginIdentifier"
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    placeholder="Enter your username or email"
                    required
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="loginPassword">Password *</label>
                <div className="input-with-icon">
                  <i className="fa-solid fa-lock input-icon"></i>
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    id="loginPassword"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="btn-toggle-pwd"
                    onClick={() => setShowLoginPassword((prev) => !prev)}
                    title={showLoginPassword ? 'Hide password' : 'Show password'}
                  >
                    <i className={`fa-solid ${showLoginPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn-modal-submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i> Authenticating...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-right-to-bracket"></i> Sign In to Account
                  </>
                )}
              </button>
            </form>
          )}

          {/* TAB 2: REGISTER */}
          {activeTab === 'register' && (
            <form onSubmit={handleRegisterSubmit} className="user-login-form">
              <div className="form-group">
                <label htmlFor="regDisplayName">Full Name / Display Name *</label>
                <div className="input-with-icon">
                  <i className="fa-solid fa-id-card input-icon"></i>
                  <input
                    type="text"
                    id="regDisplayName"
                    value={regDisplayName}
                    onChange={(e) => setRegDisplayName(e.target.value)}
                    placeholder="Enter your full name"
                    required
                    autoComplete="name"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="regUsername">Username *</label>
                <div className="input-with-icon">
                  <i className="fa-solid fa-at input-icon"></i>
                  <input
                    type="text"
                    id="regUsername"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    placeholder="Choose unique username (e.g. alex_smith)"
                    required
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="regEmail">Email Address *</label>
                <div className="input-with-icon">
                  <i className="fa-solid fa-envelope input-icon"></i>
                  <input
                    type="email"
                    id="regEmail"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="Enter your email address"
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="regPassword">Password * (min 6 characters)</label>
                <div className="input-with-icon">
                  <i className="fa-solid fa-lock input-icon"></i>
                  <input
                    type={showRegPassword ? 'text' : 'password'}
                    id="regPassword"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Create a secure password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="btn-toggle-pwd"
                    onClick={() => setShowRegPassword((prev) => !prev)}
                    title={showRegPassword ? 'Hide password' : 'Show password'}
                  >
                    <i className={`fa-solid ${showRegPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn-modal-submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i> Creating Account...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-user-plus"></i> Create Account & Save History
                  </>
                )}
              </button>
            </form>
          )}

          {/* Guest Mode Action */}
          <div className="guest-action-wrapper">
            <button
              type="button"
              className="btn-modal-guest"
              onClick={onContinueAsGuest}
            >
              <i className="fa-solid fa-user-secret"></i> Continue as Guest (Ephemeral Mode)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
