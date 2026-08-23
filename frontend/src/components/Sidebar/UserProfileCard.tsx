import React, { useState, useRef, useEffect } from 'react';
import { LuSettings, LuLogOut } from 'react-icons/lu';
import type { User } from '../../types';

interface UserProfileCardProps {
  currentUser: User | null;
  onOpenModal: () => void;
  onLogout: () => void;
}

export const UserProfileCard: React.FC<UserProfileCardProps> = ({
  currentUser,
  onOpenModal,
  onLogout,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; bottom: number }>({
    left: 12,
    bottom: 60,
  });
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close menu on outside click or Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  // If user is guest, do not render this in the sidebar (guest auth is at the top of chat)
  if (!currentUser) {
    return null;
  }

  const initial = (currentUser.display_name || currentUser.username || 'U')
    .charAt(0)
    .toUpperCase();
  const avatarBg = currentUser.avatar_color || '#3B82F6';

  const handleToggleMenu = () => {
    if (!isMenuOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
      });
    }
    setIsMenuOpen((prev) => !prev);
  };

  const handleOpenSettings = () => {
    setIsMenuOpen(false);
    onOpenModal();
  };

  const handleLogoutConfirm = () => {
    setIsMenuOpen(false);
    if (window.confirm('Are you sure you want to log out of your account?')) {
      onLogout();
    }
  };

  return (
    <div className="user-profile-bottom-wrapper">
      {/* Fixed position ChatGPT-style popover menu */}
      {isMenuOpen && (
        <div
          className="user-profile-popover"
          ref={popoverRef}
          style={{
            left: `${menuPosition.left}px`,
            bottom: `${menuPosition.bottom}px`,
          }}
        >
          <div className="popover-user-header">
            <div
              className="popover-avatar"
              style={{ backgroundColor: avatarBg }}
            >
              {initial}
            </div>
            <div className="popover-user-details">
              <span className="popover-name">{currentUser.display_name}</span>
              <span className="popover-handle">@{currentUser.username}</span>
              <span className="popover-email">{currentUser.email}</span>
            </div>
          </div>

          <div className="popover-divider"></div>

          <button
            type="button"
            className="popover-item"
            onClick={handleOpenSettings}
          >
            <LuSettings />
            <span>Settings & Account</span>
          </button>

          <div className="popover-divider"></div>

          <button
            type="button"
            className="popover-item logout-item"
            onClick={handleLogoutConfirm}
          >
            <LuLogOut />
            <span>Log out</span>
          </button>
        </div>
      )}

      {/* Bottom Profile Trigger Pill */}
      <button
        ref={buttonRef}
        type="button"
        className={`user-profile-pill ${isMenuOpen ? 'active' : ''}`}
        onClick={handleToggleMenu}
        title="Account & Settings"
      >
        <div className="user-avatar" style={{ backgroundColor: avatarBg }}>
          {initial}
        </div>
        <div className="user-info">
          <span className="user-name">{currentUser.display_name}</span>
          <span className="user-email">@{currentUser.username}</span>
        </div>
      </button>
    </div>
  );
};
