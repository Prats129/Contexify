import React, { useState, useRef, useEffect } from 'react';
import { LuSettings, LuLogOut } from 'react-icons/lu';
import { useTheme } from '../../context/ThemeContext';
import type { User } from '../../types';

interface UserProfileCardProps {
  isOpen?: boolean;
  currentUser: User | null;
  onOpenModal: () => void;
  onLogout: () => void;
}

export const UserProfileCard: React.FC<UserProfileCardProps> = ({
  isOpen = true,
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
  const { currentAccent } = useTheme();

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

  if (!currentUser) {
    return null;
  }

  const initial = (currentUser.display_name || currentUser.username || 'U')
    .charAt(0)
    .toUpperCase();
  const avatarBg = currentUser.avatar_color || currentAccent.primary;

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
    <div className="relative w-full">
      {/* Fixed position popover menu */}
      {isMenuOpen && (
        <div
          ref={popoverRef}
          className="fixed w-64 bg-(--bg-card) border border-(--border-hover) rounded-xl shadow-2xl z-1000 p-2 flex flex-col gap-1 backdrop-blur-xl animate-[popoverIn_0.18s_ease-out]"
          style={{
            left: `${menuPosition.left}px`,
            bottom: `${menuPosition.bottom}px`,
          }}
        >
          <div className="flex items-center gap-2.5 p-2 border-b border-(--border-subtle)">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-sm shrink-0"
              style={{ backgroundColor: avatarBg }}
            >
              {initial}
            </div>
            <div className="flex flex-col overflow-hidden min-w-0">
              <span className="text-xs font-semibold text-(--text-main) truncate">
                {currentUser.display_name}
              </span>
              <span className="text-[11px] text-(--text-muted) truncate">@{currentUser.username}</span>
              <span className="text-[10px] text-(--text-muted) opacity-80 truncate">{currentUser.email}</span>
            </div>
          </div>

          <button
            type="button"
            className="flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-(--text-main) hover:bg-(--border-subtle) rounded-lg cursor-pointer text-left w-full"
            onClick={handleOpenSettings}
          >
            <LuSettings size={15} />
            <span>Settings & Preferences</span>
          </button>

          <div className="h-px bg-(--border-subtle) my-0.5"></div>

          <button
            type="button"
            className="flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-red-500 hover:text-red-400 hover:bg-red-500/15 rounded-lg cursor-pointer text-left w-full"
            onClick={handleLogoutConfirm}
          >
            <LuLogOut size={15} />
            <span>Log out</span>
          </button>
        </div>
      )}

      {/* Bottom Profile Trigger Pill */}
      <button
        ref={buttonRef}
        type="button"
        className={`flex items-center gap-2.5 p-2 bg-(--border-subtle) hover:bg-(--border-hover) border border-(--border-subtle) rounded-xl cursor-pointer text-left ${isOpen ? 'w-full' : 'w-10 h-10 justify-center mx-auto rounded-full p-0'
          } ${isMenuOpen ? 'border-primary-theme' : ''}`}
        onClick={handleToggleMenu}
        title="Account & Settings"
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-xs shrink-0"
          style={{ backgroundColor: avatarBg }}
        >
          {initial}
        </div>
        {isOpen && (
          <div className="flex flex-col min-w-0 overflow-hidden">
            <span className="text-xs font-semibold text-(--text-main) truncate">{currentUser.display_name}</span>
            <span className="text-[11px] text-(--text-muted) truncate">@{currentUser.username}</span>
          </div>
        )}
      </button>
    </div>
  );
};
