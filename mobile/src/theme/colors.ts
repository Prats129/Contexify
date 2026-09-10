export const colors = {
  // Brand accents
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

export type ThemeMode = 'dark' | 'light';
