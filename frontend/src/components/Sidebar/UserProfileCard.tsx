import React from 'react';
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
  const isGuest = !currentUser;
  const initial = (currentUser?.display_name || currentUser?.username || 'G')
    .charAt(0)
    .toUpperCase();
  const avatarBg = isGuest ? '#6B7280' : currentUser?.avatar_color || '#3B82F6';

  return (
    <div
      className={`user-profile-card ${isGuest ? 'guest-mode' : ''}`}
      onClick={onOpenModal}
      title={isGuest ? 'Click to Sign In or Create Account' : 'Click to View Account Details'}
    >
      <div className="user-avatar" style={{ backgroundColor: avatarBg }}>
        {isGuest ? <i className="fa-solid fa-user"></i> : initial}
      </div>
      <div className="user-info">
        <span className="user-name">
          {currentUser?.display_name || (isGuest ? 'Guest Visitor' : currentUser?.username)}
        </span>
        <span className="user-email">
          {isGuest ? 'Ephemeral Mode' : `@${currentUser?.username}`}
        </span>
      </div>
      {isGuest ? (
        <button
          type="button"
          className="btn-switch-user"
          onClick={(e) => {
            e.stopPropagation();
            onOpenModal();
          }}
          title="Sign In / Register"
        >
          <i className="fa-solid fa-right-to-bracket"></i>
        </button>
      ) : (
        <button
          type="button"
          className="btn-logout-user"
          onClick={(e) => {
            e.stopPropagation();
            onLogout();
          }}
          title="Log Out"
        >
          <i className="fa-solid fa-arrow-right-from-bracket"></i>
        </button>
      )}
    </div>
  );
};
