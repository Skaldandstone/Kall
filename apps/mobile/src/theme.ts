// Meridian x Clay. Mirrors the tokens in apps/web/app/globals.css -- these
// two drifted apart badly before (mobile stayed on the forest-green brand
// while web moved to neutral grey), so any change here needs the matching
// change there.
export const theme = {
  background: '#0c1420',
  surface: '#131d2c',
  surfaceRaised: '#1c2839',
  surfaceInteractive: '#24334a',
  border: '#2b3d55',
  borderStrong: '#3d5473',
  text: '#e8ecf2',
  textSecondary: '#94a5bc',
  // Clears WCAG AA for normal text on both background and surface.
  textMuted: '#7b90aa',
  // Brass. Marks the primary action and the single most important number on
  // a screen -- not a state colour, and never placed beside `warning`.
  accent: '#c9a86a',
  accentHover: '#dcbf84',
  accentInk: '#0c1420',
  success: '#6fae8f',
  warning: '#d9a441',
  danger: '#d97362',
  overlay: 'rgba(12, 20, 32, 0.72)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const type = { caption: 12, body: 15, title: 18, display: 28 } as const;

export const elevation = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 3,
  },
} as const;
