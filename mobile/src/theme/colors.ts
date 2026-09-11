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
  lightBg: string;
  border: string;
}

export const ACCENT_PALETTES: Record<AccentColor, AccentOption> = {
  blue: {
    id: 'blue',
    label: 'Ocean Blue',
    primary: '#2563eb',
    hover: '#1d4ed8',
    lightBg: 'rgba(37, 99, 235, 0.15)',
    border: 'rgba(37, 99, 235, 0.35)',
  },
  purple: {
    id: 'purple',
    label: 'Royal Violet',
    primary: '#8b5cf6',
    hover: '#7c3aed',
    lightBg: 'rgba(139, 92, 246, 0.15)',
    border: 'rgba(139, 92, 246, 0.35)',
  },
  emerald: {
    id: 'emerald',
    label: 'Forest Emerald',
    primary: '#10b981',
    hover: '#059669',
    lightBg: 'rgba(16, 185, 129, 0.15)',
    border: 'rgba(16, 185, 129, 0.35)',
  },
  rose: {
    id: 'rose',
    label: 'Crimson Rose',
    primary: '#f43f5e',
    hover: '#e11d48',
    lightBg: 'rgba(244, 63, 94, 0.15)',
    border: 'rgba(244, 63, 94, 0.35)',
  },
  amber: {
    id: 'amber',
    label: 'Sunset Amber',
    primary: '#f59e0b',
    hover: '#d97706',
    lightBg: 'rgba(245, 158, 11, 0.15)',
    border: 'rgba(245, 158, 11, 0.35)',
  },
  indigo: {
    id: 'indigo',
    label: 'Deep Indigo',
    primary: '#6366f1',
    hover: '#4f46e5',
    lightBg: 'rgba(99, 102, 241, 0.15)',
    border: 'rgba(99, 102, 241, 0.35)',
  },
  cyan: {
    id: 'cyan',
    label: 'Cyber Cyan',
    primary: '#06b6d4',
    hover: '#0891b2',
    lightBg: 'rgba(6, 182, 212, 0.15)',
    border: 'rgba(6, 182, 212, 0.35)',
  },
};

export const colors = {
  // Brand accents default (Blue)
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  primaryLight: 'rgba(37, 99, 235, 0.15)',
  primaryBorder: 'rgba(37, 99, 235, 0.35)',

  // Web search mode green
  emerald: '#10b981',
  emeraldLight: 'rgba(16, 185, 129, 0.15)',
  emeraldBorder: 'rgba(16, 185, 129, 0.35)',

  // Danger / alerts
  danger: '#ef4444',
  dangerLight: 'rgba(239, 68, 68, 0.15)',
  dangerBorder: 'rgba(239, 68, 68, 0.35)',

  // Dark Mode Surface Palette
  dark: {
    bgApp: '#030712',
    bgCard: '#111827',
    bgInput: '#1f2937',
    bgSidebar: '#0b0f19',
    textMain: '#f9fafb',
    textMuted: '#9ca3af',
    borderSubtle: 'rgba(255, 255, 255, 0.08)',
    borderHover: 'rgba(255, 255, 255, 0.18)',
    userBubble: '#2563eb',
    userText: '#ffffff',
    aiBubble: '#111827',
    aiText: '#f9fafb',
  },

  // Light Mode Surface Palette
  light: {
    bgApp: '#f8fafc',
    bgCard: '#ffffff',
    bgInput: '#f1f5f9',
    bgSidebar: '#ffffff',
    textMain: '#0f172a',
    textMuted: '#64748b',
    borderSubtle: 'rgba(0, 0, 0, 0.08)',
    borderHover: 'rgba(0, 0, 0, 0.18)',
    userBubble: '#2563eb',
    userText: '#ffffff',
    aiBubble: '#ffffff',
    aiText: '#0f172a',
  },
};

export function getAppTheme(isDark: boolean, accent: AccentColor = 'blue') {
  const pal = ACCENT_PALETTES[accent] || ACCENT_PALETTES.blue;
  const surface = isDark ? colors.dark : colors.light;

  return {
    ...surface,
    primary: pal.primary,
    primaryHover: pal.hover,
    primaryLight: pal.lightBg,
    primaryBorder: pal.border,
    userBubble: pal.primary,
    emerald: colors.emerald,
    emeraldLight: colors.emeraldLight,
    emeraldBorder: colors.emeraldBorder,
    danger: colors.danger,
    dangerLight: colors.dangerLight,
    dangerBorder: colors.dangerBorder,
  };
}

export type AppTheme = ReturnType<typeof getAppTheme>;
