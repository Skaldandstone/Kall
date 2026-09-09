// Meridian x Clay. Mirrors the tokens in apps/web/app/globals.css -- these
// two drifted apart badly before (mobile stayed on the forest-green brand
// while web moved to neutral grey), so any change here needs the matching
// change there.
export const theme = {
  background: '#09111d',
  backgroundSoft: '#0d1725',
  surface: '#111c2b',
  surfaceRaised: '#182538',
  surfaceInteractive: '#213149',
  border: '#25364c',
  borderStrong: '#38506f',
  text: '#f4f1e9',
  textSecondary: '#aab7c8',
  // Clears WCAG AA for normal text on both background and surface.
  textMuted: '#8497b1',
  // Brass. Marks the primary action and the single most important number on
  // a screen -- not a state colour, and never placed beside `warning`.
  accent: '#d8b66f',
  accentSoft: '#352f27',
  accentWash: '#1d2a3b',
  accentHover: '#e5c98e',
  accentInk: '#101721',
  success: '#6fae8f',
  warning: '#d9a441',
  danger: '#d97362',
  overlay: 'rgba(12, 20, 32, 0.72)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 36 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;
export const type = { caption: 12, body: 15, title: 19, display: 28 } as const;

export const elevation = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 5,
  },
} as const;
