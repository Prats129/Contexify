import React, { useState, useEffect } from 'react';
import { apiService } from '../../services/api';
import type { User } from '../../types';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  onSwitchUser: (userId: string) => void;
  onRegisterUser: (
    username: string,
    email: string | null,
    displayName: string | null
  ) => void;
  onContinueAsGuest: () => void;
}

export const UserModal: React.FC<UserModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onSwitchUser,
  onRegisterUser,
  onContinueAsGuest,
}) => {
  const [usersList, setUsersList] = useState<User[]>([]);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadUsers();
      setUsername('');
      setDisplayName('');
      setEmail('');
    }
  }, [isOpen]);

  const loadUsers = async () => {
    try {
      setLoadingUsers(true);
      const list = await apiService.listUsers();
      setUsersList(list || []);
    } catch (e) {
      console.error('Failed to list users:', e);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    onRegisterUser(
      username.trim(),
      email.trim() || null,
      displayName.trim() || null
    );
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <i className="fa-solid fa-user-gear"></i>
            <h3>User Profile & Account</h3>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="modal-body">
          {/* Switch existing user */}
          <div className="modal-subheading">Switch Profile</div>
          <div className="existing-users-list">
            {loadingUsers ? (
              <div className="empty-users-hint">Loading profiles...</div>
            ) : usersList.length > 0 ? (
              usersList.map((u) => {
                const isActive = currentUser && currentUser.id === u.id;
                const initial = (u.display_name || u.username)
                  .charAt(0)
                  .toUpperCase();
                return (
                  <div
                    key={u.id}
                    className={`user-chip ${isActive ? 'active-user' : ''}`}
                    onClick={() => onSwitchUser(u.id)}
                  >
                    <div
                      className="chip-avatar"
                      style={{ backgroundColor: u.avatar_color || '#3B82F6' }}
                    >
                      {initial}
                    </div>
                    <span>{u.display_name || u.username}</span>
                  </div>
                );
              })
            ) : (
              <div className="empty-users-hint">No other profiles found.</div>
            )}
          </div>

          <div className="modal-divider">
            <span>OR SIGN IN / CREATE NEW</span>
          </div>

          {/* Create/Login Form */}
          <form onSubmit={handleSubmit} className="user-login-form">
            <div className="form-group">
              <label htmlFor="inputUsername">Username *</label>
              <input
                type="text"
                id="inputUsername"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                required
                autoComplete="off"
              />
            </div>
            <div className="form-group">
              <label htmlFor="inputDisplayName">Display Name (Optional)</label>
              <input
                type="text"
                id="inputDisplayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your name"
              />
            </div>
            <div className="form-group">
              <label htmlFor="inputEmail">Email (Optional)</label>
              <input
                type="email"
                id="inputEmail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
              />
            </div>
            <button type="submit" className="btn-modal-submit">
              <i className="fa-solid fa-right-to-bracket"></i> Sign In & Save History
            </button>
          </form>

          {/* Guest Mode Option */}
          <div className="guest-action-wrapper">
            <button
              type="button"
              className="btn-modal-guest"
              onClick={onContinueAsGuest}
            >
              <i className="fa-solid fa-user-secret"></i> Continue as Guest (No Data Saved to DB)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
