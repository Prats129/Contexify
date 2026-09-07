import React, { useEffect, useRef } from 'react';
import { ConfirmOptions } from '../../context/ConfirmContext';

interface ConfirmModalProps {
  isOpen: boolean;
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  options,
  onConfirm,
  onCancel,
}) => {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Focus confirm button and handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      confirmBtnRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const {
    title,
    message,
    confirmText,
    cancelText = 'Cancel',
    type = 'default',
    user,
    chatTitle,
    subtext,
    variant = 'danger',
  } = options;

  // --- 1. LOGOUT MODAL VARIANT (Exact ChatGPT layout - Image 3) ---
  if (type === 'logout') {
    return (
      <div
        className="fixed inset-0 z-99999 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
        onClick={onCancel}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="bg-(--bg-card) border border-(--border-hover) rounded-3xl w-full max-w-85 sm:max-w-sm shadow-2xl p-4 sm:p-5 flex flex-col items-center text-center gap-5 sm:gap-4 animate-[popoverIn_0.18s_cubic-bezier(0.16,1,0.3,1)] relative"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Centered Large Bold Title */}
          <h2 className="text-xl sm:text-xl font-bold text-(--text-main) tracking-tight leading-tight">
            Are you sure you want to log out ?
          </h2>

          {/* User Account Card */}
          {user && (
            <div className="w-[90%] flex items-center gap-3 p-2 rounded-2xl bg-(--border-subtle)/50 border border-(--border-subtle) text-left">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm shrink-0 shadow-sm"
                style={{ backgroundColor: user.avatarColor || '#334155' }}
              >
                {user.initial || user.displayName?.slice(0, 2)?.toUpperCase() || 'U'}
              </div>
              <div className="flex flex-col min-w-0 overflow-hidden">
                <span className="text-sm font-semibold text-(--text-main) truncate">
                  {user.displayName}
                </span>
                <span className="text-xs text-(--text-muted) truncate">
                  {user.email}
                </span>
              </div>
            </div>
          )}

          {/* Full-width Action Buttons */}
          <div className="flex flex-col w-full gap-2.5">
            <button
              ref={confirmBtnRef}
              type="button"
              onClick={onConfirm}
              className="w-full py-2 px-5 rounded-full font-semibold text-sm bg-white border-2 border-slate-300 hover:border-red-500 border-dashed text-black hover:text-red-500 hover:bg-gray-200 transition-colors cursor-pointer shadow-sm active:scale-[0.99]"
            >
              {confirmText || 'Log out'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-2 px-5 rounded-full font-medium text-sm bg-(--border-subtle) hover:bg-(--border-hover) text-(--text-main) border border-(--border-subtle) transition-colors cursor-pointer active:scale-[0.99]"
            >
              {cancelText}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- 2. DELETE CHAT MODAL VARIANT (Exact ChatGPT layout - Image 2) ---
  if (type === 'delete-chat') {
    return (
      <div
        className="fixed inset-0 z-99999 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
        onClick={onCancel}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="bg-(--bg-card) border border-(--border-hover) rounded-2xl w-full max-w-md shadow-2xl p-4 flex flex-col gap-0.5 animate-[popoverIn_0.18s_cubic-bezier(0.16,1,0.3,1)] text-left"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-bold text-(--text-main) tracking-tight">
            {title || 'Delete chat?'}
          </h3>

          <p className="text-sm text-(--text-main) leading-relaxed">
            This will delete{' '}
            <strong className="font-bold text-(--text-main)">
              {chatTitle || 'this chat'}
            </strong>
            .
          </p>

          <p className="text-xs text-(--text-muted) leading-normal">
            {subtext || 'All messages and conversation history in this chat will be permanently deleted.'}
          </p>

          <div className="flex items-center justify-end gap-1 pt-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-5 py-2 rounded-full text-sm font-medium bg-(--border-subtle) hover:bg-(--border-hover) text-(--text-main) transition-colors cursor-pointer"
            >
              {cancelText}
            </button>
            <button
              ref={confirmBtnRef}
              type="button"
              onClick={onConfirm}
              className="px-5 py-2 rounded-full text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer active:scale-95 shadow-sm"
            >
              {confirmText || 'Delete'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- 3. ALERT / ERROR MODAL VARIANT (Image 1 Native Alert Replacement) ---
  if (type === 'alert') {
    return (
      <div
        className="fixed inset-0 z-99999 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
        onClick={onConfirm}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="bg-(--bg-card) border border-(--border-hover) rounded-2xl w-full max-w-md shadow-2xl p-6 flex flex-col gap-3 animate-[popoverIn_0.18s_cubic-bezier(0.16,1,0.3,1)] text-left"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-bold text-(--text-main) tracking-tight">
            {title || 'Notice'}
          </h3>

          <div className="text-xs sm:text-sm text-(--text-muted) leading-relaxed wrap-break-word whitespace-pre-wrap max-h-60 overflow-y-auto pr-1">
            {message}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-(--border-subtle) mt-1">
            <button
              ref={confirmBtnRef}
              type="button"
              onClick={onConfirm}
              className="px-5 py-2 rounded-full text-sm font-semibold bg-white text-black hover:bg-gray-200 transition-colors cursor-pointer shadow-sm active:scale-95"
            >
              {confirmText || 'OK'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- 4. DEFAULT CONFIRMATION (Clean Minimalist Card) ---
  const isDanger = variant === 'danger';

  return (
    <div
      className="fixed inset-0 z-99999 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-(--bg-card) border border-(--border-hover) rounded-2xl w-full max-w-md shadow-2xl p-4 flex flex-col gap-1 animate-[popoverIn_0.18s_cubic-bezier(0.16,1,0.3,1)] text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-(--text-main) tracking-tight">
          {title || 'Confirm Action'}
        </h3>

        {message && (
          <p className="text-xs sm:text-xs text-(--text-muted) leading-normal">
            {message}
          </p>
        )}

        <div className="flex items-center justify-end gap-1 pt-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2 rounded-full text-sm font-medium bg-(--border-subtle) hover:bg-(--border-hover) text-(--text-main) transition-colors cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className={`px-5 py-2 rounded-full text-sm font-semibold text-white transition-colors cursor-pointer active:scale-95 shadow-sm ${isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-theme hover:opacity-90'
              }`}
          >
            {confirmText || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};
