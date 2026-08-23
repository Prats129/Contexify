import React, { createContext, useContext, useState, useEffect } from 'react';

export type ThemeMode = 'dark' | 'light';

export type AccentColor =
  | 'blue'
  | 'purple'
  | 'emerald'
  | 'rose'
  | 'amber'
  | 'indigo'
  | 'cyan';

export interface AccentOption {
  id: AccentColor;
  label: string;
  primary: string;
  hover: string;
  gradientFrom: string;
  gradientTo: string;
  lightBg: string;
  border: string;
  glow: string;
}

export const ACCENT_PALETTES: Record<AccentColor, AccentOption> = {
  blue: {
    id: 'blue',
    label: 'Ocean Blue',
    primary: '#2563eb',
    hover: '#1d4ed8',
    gradientFrom: '#2563eb',
    gradientTo: '#4f46e5',
    lightBg: 'rgba(37, 99, 235, 0.15)',
    border: 'rgba(37, 99, 235, 0.35)',
    glow: 'rgba(37, 99, 235, 0.25)',
  },
  purple: {
    id: 'purple',
    label: 'Royal Violet',
    primary: '#8b5cf6',
    hover: '#7c3aed',
    gradientFrom: '#8b5cf6',
    gradientTo: '#c084fc',
    lightBg: 'rgba(139, 92, 246, 0.15)',
    border: 'rgba(139, 92, 246, 0.35)',
    glow: 'rgba(139, 92, 246, 0.25)',
  },
  emerald: {
    id: 'emerald',
    label: 'Forest Emerald',
    primary: '#10b981',
    hover: '#059669',
    gradientFrom: '#10b981',
    gradientTo: '#14b8a6',
    lightBg: 'rgba(16, 185, 129, 0.15)',
    border: 'rgba(16, 185, 129, 0.35)',
    glow: 'rgba(16, 185, 129, 0.25)',
  },
  rose: {
    id: 'rose',
    label: 'Crimson Rose',
    primary: '#f43f5e',
    hover: '#e11d48',
    gradientFrom: '#f43f5e',
    gradientTo: '#fb7185',
    lightBg: 'rgba(244, 63, 94, 0.15)',
    border: 'rgba(244, 63, 94, 0.35)',
    glow: 'rgba(244, 63, 94, 0.25)',
  },
  amber: {
    id: 'amber',
    label: 'Sunset Amber',
    primary: '#f59e0b',
    hover: '#d97706',
    gradientFrom: '#f59e0b',
    gradientTo: '#fbbf24',
    lightBg: 'rgba(245, 158, 11, 0.15)',
    border: 'rgba(245, 158, 11, 0.35)',
    glow: 'rgba(245, 158, 11, 0.25)',
  },
  indigo: {
    id: 'indigo',
    label: 'Deep Indigo',
    primary: '#6366f1',
    hover: '#4f46e5',
    gradientFrom: '#6366f1',
    gradientTo: '#818cf8',
    lightBg: 'rgba(99, 102, 241, 0.15)',
    border: 'rgba(99, 102, 241, 0.35)',
    glow: 'rgba(99, 102, 241, 0.25)',
  },
  cyan: {
    id: 'cyan',
    label: 'Cyber Cyan',
    primary: '#06b6d4',
    hover: '#0891b2',
    gradientFrom: '#06b6d4',
    gradientTo: '#38bdf8',
    lightBg: 'rgba(6, 182, 212, 0.15)',
    border: 'rgba(6, 182, 212, 0.35)',
    glow: 'rgba(6, 182, 212, 0.25)',
  },
};

interface ThemeContextType {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
  currentAccent: AccentOption;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'contexify_theme_mode';
const ACCENT_STORAGE_KEY = 'contexify_accent_color';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark'; // Dark mode default
  });

  const [accent, setAccentState] = useState<AccentColor>(() => {
    const saved = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (saved && saved in ACCENT_PALETTES) return saved as AccentColor;
    return 'blue';
  });

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem(THEME_STORAGE_KEY, newMode);
  };

  const toggleMode = () => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  };

  const setAccent = (newAccent: AccentColor) => {
    setAccentState(newAccent);
    localStorage.setItem(ACCENT_STORAGE_KEY, newAccent);
  };

  const currentAccent = ACCENT_PALETTES[accent] || ACCENT_PALETTES.blue;

  // Apply CSS variables and root classes whenever theme or accent changes
  useEffect(() => {
    const root = document.documentElement;

    // Apply dark/light class
    if (mode === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
    root.setAttribute('data-theme', mode);
    root.setAttribute('data-accent', accent);

    // Set Dynamic Primary Accent CSS Variables
    root.style.setProperty('--color-primary', currentAccent.primary);
    root.style.setProperty('--color-primary-hover', currentAccent.hover);
    root.style.setProperty('--color-primary-gradient-from', currentAccent.gradientFrom);
    root.style.setProperty('--color-primary-gradient-to', currentAccent.gradientTo);
    root.style.setProperty('--color-primary-light', currentAccent.lightBg);
    root.style.setProperty('--color-primary-border', currentAccent.border);
    root.style.setProperty('--color-primary-glow', currentAccent.glow);

    // Set Base Theme Surface CSS Variables based on Light/Dark
    if (mode === 'dark') {
      root.style.setProperty('--bg-app', '#030712'); // Gray 950
      root.style.setProperty('--bg-sidebar', '#111827'); // Gray 900
      root.style.setProperty('--bg-card', '#1f2937'); // Gray 800
      root.style.setProperty('--bg-input', 'rgba(17, 24, 39, 0.9)');
      root.style.setProperty('--bg-bubble-ai', '#111827');
      root.style.setProperty('--text-main', '#f9fafb');
      root.style.setProperty('--text-muted', '#9ca3af');
      root.style.setProperty('--border-subtle', 'rgba(255, 255, 255, 0.1)');
      root.style.setProperty('--border-hover', 'rgba(255, 255, 255, 0.2)');
    } else {
      root.style.setProperty('--bg-app', '#f8fafc'); // Slate 50
      root.style.setProperty('--bg-sidebar', '#ffffff'); // White
      root.style.setProperty('--bg-card', '#ffffff');
      root.style.setProperty('--bg-input', 'rgba(255, 255, 255, 0.95)');
      root.style.setProperty('--bg-bubble-ai', '#ffffff');
      root.style.setProperty('--text-main', '#0f172a'); // Slate 900
      root.style.setProperty('--text-muted', '#64748b'); // Slate 500
      root.style.setProperty('--border-subtle', 'rgba(0, 0, 0, 0.1)');
      root.style.setProperty('--border-hover', 'rgba(0, 0, 0, 0.2)');
    }
  }, [mode, accent, currentAccent]);

  return (
    <ThemeContext.Provider
      value={{
        mode,
        setMode,
        toggleMode,
        accent,
        setAccent,
        currentAccent,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
