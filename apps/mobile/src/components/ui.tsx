import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
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

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return <View accessible={false} style={[styles.brandMark, compact && styles.brandMarkCompact]}>
    <Image source={require('../../assets/brand-mark.png')} resizeMode="contain" style={[styles.brandImage, compact && styles.brandImageCompact]} />
  </View>;
}

export function SectionHeader({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <View style={styles.sectionHeader}><View style={styles.sectionCopy}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}</View>{action}</View>;
}

export function StagePill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'success' }) {
  return <View style={[styles.pill, tone === 'accent' && styles.pillAccent, tone === 'success' && styles.pillSuccess]}><Text style={[styles.pillText, tone === 'accent' && styles.pillTextAccent]}>{children}</Text></View>;
}

export function Card({ children, emphasized = false, style }: { children: ReactNode; emphasized?: boolean; style?: object }) {
  return <View style={[styles.card, emphasized && styles.cardEmphasized, style]}>{children}</View>;
}

export function EmptyState({ title, description, actionLabel, onAction }: { title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return <Card style={styles.empty}>
    <View accessible={false} style={styles.emptyMark}><Ionicons name="sparkles-outline" size={23} color={theme.accent} /></View>
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
  primaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  primaryButtonText: { color: theme.accentInk, fontSize: type.body, fontWeight: '800' },
  secondaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceRaised, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  secondaryButtonText: { color: theme.text, fontSize: type.body, fontWeight: '700' },
  input: { minHeight: 52, borderWidth: 1, borderColor: theme.border, borderRadius: radius.md, backgroundColor: theme.surfaceRaised, color: theme.text, paddingHorizontal: 16, fontSize: 16 },
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.xl },
  headerCopy: { flex: 1 },
  eyebrow: { color: theme.accent, fontSize: 11, lineHeight: 15, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: spacing.sm },
  title: { color: theme.text, fontSize: type.display, lineHeight: 33, fontWeight: '700', letterSpacing: -0.65 },
  description: { color: theme.textSecondary, fontSize: type.body, lineHeight: 22, marginTop: spacing.sm, maxWidth: 360 },
  brandMark: { width: 48, height: 48, borderRadius: 15, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0c1420', shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  brandMarkCompact: { width: 34, height: 34, borderRadius: 11 },
  brandImage: { width: 104, height: 104 },
  brandImageCompact: { width: 74, height: 74 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.md },
  sectionCopy: { flex: 1 },
  sectionTitle: { color: theme.text, fontSize: 18, lineHeight: 23, fontWeight: '700', letterSpacing: -0.25 },
  sectionDetail: { color: theme.textMuted, fontSize: 13, lineHeight: 18, marginTop: 3 },
  pill: { alignSelf: 'flex-start', minHeight: 26, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: theme.surfaceInteractive, paddingHorizontal: 10 },
  pillAccent: { backgroundColor: theme.accentSoft },
  pillSuccess: { backgroundColor: '#19342e' },
  pillText: { color: theme.textSecondary, fontSize: 11, fontWeight: '700' },
  pillTextAccent: { color: theme.accentHover },
  card: { ...elevation.card, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg },
  cardEmphasized: { backgroundColor: theme.surfaceRaised },
  empty: { marginTop: spacing.md, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xxl, alignItems: 'center' },
  emptyMark: { width: 48, height: 48, borderRadius: 16, backgroundColor: theme.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
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
