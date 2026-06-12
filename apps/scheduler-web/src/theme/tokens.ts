// Design tokens — single source of truth for colors, spacing, radius and typography.
// Import these instead of hardcoding values in StyleSheet or inline styles.

export const colors = {
  // Brand
  primary: '#25D366',       // WhatsApp green — CTAs, success states
  primaryDark: '#128C7E',   // Hover / pressed state
  primaryMuted: 'rgba(37, 211, 102, 0.12)',

  // Backgrounds (dark-first design)
  bgBase: '#0F172A',        // Page background
  bgSurface: '#1E293B',     // Cards, panels
  bgRaised: '#334155',      // Elevated items (dropdowns, tooltips)
  bgOverlay: 'rgba(0, 0, 0, 0.6)',

  // Borders
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderMuted: 'rgba(255, 255, 255, 0.1)',
  borderDefault: '#334155',
  borderPrimary: 'rgba(37, 211, 102, 0.25)',

  // Text
  textPrimary: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textInverse: '#0F172A',   // Text on green buttons

  // Semantic — AI / Sarah
  ai: '#818CF8',
  aiMuted: 'rgba(129, 140, 248, 0.12)',
  aiBorder: 'rgba(129, 140, 248, 0.25)',

  // Semantic — Status
  danger: '#EF4444',
  dangerMuted: 'rgba(239, 68, 68, 0.1)',
  dangerBorder: 'rgba(239, 68, 68, 0.2)',

  warning: '#F59E0B',
  warningMuted: 'rgba(245, 158, 11, 0.1)',
  warningBorder: 'rgba(245, 158, 11, 0.2)',

  success: '#25D366',
  successMuted: 'rgba(37, 211, 102, 0.08)',
  successBorder: 'rgba(37, 211, 102, 0.2)',

  // Neutral grays (for KPI cards, misc)
  slate50: '#F8FAFC',
  slate100: '#F1F5F9',
  slate200: '#E2E8F0',
  slate300: '#CBD5E1',
  slate400: '#94A3B8',
  slate500: '#64748B',
  slate600: '#475569',
  slate700: '#334155',
  slate800: '#1E293B',
  slate900: '#0F172A',
};

// 4pt spacing grid
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// Unified border radius scale
export const radius = {
  sm: 4,    // badges, chips
  md: 8,    // inputs, buttons
  lg: 12,   // cards, panels
  xl: 16,   // modals, large cards
  full: 999, // pills, avatars
};

// Type scale
export const fontSize = {
  xs: 11,
  sm: 13,
  md: 14,
  base: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  display: 32,
};
