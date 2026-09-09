import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { elevation, radius, spacing, theme, type } from '../theme';

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <View style={styles.header}>
    <View style={styles.headerCopy}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
    {action}
  </View>;
}

export function Card({ children, emphasized = false, style }: { children: ReactNode; emphasized?: boolean; style?: object }) {
  return <View style={[styles.card, emphasized && styles.cardEmphasized, style]}>{children}</View>;
}

export function EmptyState({ title, description, actionLabel, onAction }: { title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return <Card style={styles.empty}>
    <View accessible={false} style={styles.emptyMark}><View style={styles.emptyMarkInner} /></View>
    <Text accessibilityRole="header" style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.emptyDescription}>{description}</Text>
    {actionLabel && onAction ? <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={onAction}><Text style={styles.primaryButtonText}>{actionLabel}</Text></Pressable> : null}
  </Card>;
}

export function StatusMessage({ children, kind = 'neutral' }: { children: ReactNode; kind?: 'neutral' | 'error' | 'success' }) {
  return <View accessibilityRole={kind === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite" style={[styles.status, kind === 'error' && styles.statusError, kind === 'success' && styles.statusSuccess]}><Text style={[styles.statusText, kind === 'error' && styles.statusErrorText]}>{children}</Text></View>;
}

export const uiStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  screenContent: { paddingHorizontal: spacing.xl, paddingBottom: 48 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  primaryButtonText: { color: theme.accentInk, fontSize: type.body, fontWeight: '800' },
  secondaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.borderStrong, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  secondaryButtonText: { color: theme.text, fontSize: type.body, fontWeight: '700' },
  input: { minHeight: 52, borderWidth: 1, borderColor: theme.borderStrong, borderRadius: radius.md, backgroundColor: theme.surfaceRaised, color: theme.text, paddingHorizontal: 14, fontSize: 16 },
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.xl },
  headerCopy: { flex: 1 },
  eyebrow: { color: theme.accent, fontSize: type.caption, lineHeight: 16, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: spacing.xs },
  title: { color: theme.text, fontSize: type.display, lineHeight: 34, fontWeight: '800', letterSpacing: -0.5 },
  description: { color: theme.textSecondary, fontSize: type.body, lineHeight: 21, marginTop: spacing.sm },
  card: { ...elevation.card, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg },
  cardEmphasized: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderStrong },
  empty: { marginTop: spacing.md, paddingVertical: spacing.xxl, alignItems: 'center' },
  emptyMark: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: theme.borderStrong, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  emptyMarkInner: { width: 16, height: 16, borderRadius: 8, backgroundColor: theme.accent },
  emptyTitle: { color: theme.text, fontSize: type.title, lineHeight: 24, fontWeight: '800', textAlign: 'center' },
  emptyDescription: { color: theme.textSecondary, fontSize: type.body, lineHeight: 22, textAlign: 'center', marginTop: spacing.sm, maxWidth: 320 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent, borderRadius: radius.md, marginTop: spacing.xl, paddingHorizontal: spacing.xl },
  primaryButtonText: { color: theme.accentInk, fontWeight: '800', fontSize: type.body },
  status: { backgroundColor: theme.surfaceRaised, borderLeftWidth: 3, borderLeftColor: theme.borderStrong, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md },
  statusError: { borderLeftColor: theme.danger },
  statusSuccess: { borderLeftColor: theme.success },
  statusText: { color: theme.textSecondary, fontSize: 14, lineHeight: 20 },
  statusErrorText: { color: theme.text },
});
