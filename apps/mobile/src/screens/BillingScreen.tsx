import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import { fetchBillingStatus, fetchUsage, type BillingStatus, type MeterState, type Usage } from '../api/billing';
import { mobilePurchasesEnabled } from '../components/PurchaseBootstrap';
import { theme } from '../theme';

const MB = 1024 * 1024;
const METER_LABELS: Record<string, string> = {
  applications: 'Applications',
  ai_actions: 'AI actions',
  storage_bytes: 'Resume storage',
};
const RESET_COPY: Record<string, string> = {
  week: 'Resets each Monday',
  month: 'Resets on the 1st',
  lifetime: 'Does not reset',
};

function formatUsed(meter: string, state: MeterState): string {
  if (meter === 'storage_bytes') {
    const used = (state.used / MB).toFixed(state.used < MB ? 2 : 0);
    return state.limit === null ? `${used} MB used` : `${used} of ${Math.round(state.limit / MB)} MB`;
  }
  return state.limit === null ? `${state.used} used` : `${state.used} of ${state.limit}`;
}

function fraction(state: MeterState): number | null {
  if (state.limit === null || state.limit === 0) return null;
  return Math.min(1, state.used / state.limit);
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/cancel/i.test(message)) return '';
  return 'The store could not complete that request. Please try again.';
}

export default function BillingScreen() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const purchasesEnabled = mobilePurchasesEnabled();

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [nextStatus, nextUsage] = await Promise.all([fetchBillingStatus(), fetchUsage().catch(() => null)]);
      setStatus(nextStatus);
      setUsage(nextUsage);
      if (purchasesEnabled) {
        const offerings = await Purchases.getOfferings();
        setPackages(offerings.current?.availablePackages ?? []);
      }
      setMessage('');
    } catch {
      setMessage('Unable to refresh billing right now.');
    } finally {
      setBusy(false);
    }
  }, [purchasesEnabled]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  async function buy(aPackage: PurchasesPackage) {
    setBusy(true);
    setMessage('');
    try {
      await Purchases.purchasePackage(aPackage);
      setMessage('Purchase confirmed by the store. Refreshing your Kall access…');
      await load();
    } catch (error) {
      setMessage(friendlyError(error));
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    setMessage('');
    try {
      await Purchases.restorePurchases();
      setMessage('Purchases restored. Refreshing your Kall access…');
      await load();
    } catch (error) {
      setMessage(friendlyError(error));
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>Your access</Text>
      <Text style={styles.title}>{status?.plan ? `${status.plan[0].toUpperCase()}${status.plan.slice(1)}` : 'Loading…'}</Text>
      <Text style={styles.copy}>
        Your plan follows your Kall account across web, Android, and iOS.
      </Text>
      {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
      {busy && !status ? <ActivityIndicator color={theme.accent} style={styles.spinner} /> : null}

      {usage ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Usage</Text>
          {usage.billing_exempt ? <Text style={styles.copy}>No limits apply to this account.</Text> : null}
          {Object.entries(usage.meters).map(([meter, state]) => {
            const share = fraction(state);
            const nearly = share !== null && share >= 0.8;
            return (
              <View key={meter} style={styles.meter} accessible accessibilityLabel={`${METER_LABELS[meter] ?? meter}: ${formatUsed(meter, state)}`}>
                <View style={styles.meterRow}>
                  <Text style={styles.meterLabel}>{METER_LABELS[meter] ?? meter.replace(/_/g, ' ')}</Text>
                  <Text style={[styles.meterValue, nearly && styles.meterValueNearly]}>{formatUsed(meter, state)}</Text>
                </View>
                {share !== null ? (
                  <View style={styles.track}><View style={[styles.fill, nearly && styles.fillNearly, { width: `${Math.max(2, Math.round(share * 100))}%` }]} /></View>
                ) : null}
                <Text style={styles.meterHint}>{state.limit === null ? 'Unlimited' : RESET_COPY[state.period] ?? state.period}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {purchasesEnabled && status?.native_enabled ? (
        <View style={styles.stack}>
          {packages.map((item) => (
            <View key={item.identifier} style={styles.card}>
              <Text style={styles.cardTitle}>{item.product.title}</Text>
              <Text style={styles.copy}>{item.product.description}</Text>
              <Text style={styles.price}>{item.product.priceString}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Choose ${item.product.title} for ${item.product.priceString}`}
                disabled={busy}
                style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
                onPress={() => void buy(item)}
              >
                <Text style={styles.primaryText}>Choose {item.product.title}</Text>
              </Pressable>
            </View>
          ))}
          {!busy && packages.length === 0 ? (
            <Text style={styles.copy}>No mobile subscription options are available right now.</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            style={({ pressed }) => [styles.secondary, (pressed || busy) && styles.pressed]}
            onPress={() => void restore()}
          >
            <Text style={styles.secondaryText}>Restore purchases</Text>
          </Pressable>
        </View>
      ) : (
        // Deliberately no link out. Google Play and the App Store both
        // prohibit pointing an app at an external checkout for a digital
        // subscription; until native purchases are provisioned this screen
        // is read-only and only reports the plan the account already has.
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Plan changes are not available in the app yet</Text>
          <Text style={styles.copy}>Your current plan is shown above and applies everywhere you sign in to Kall.</Text>
        </View>
      )}
      {purchasesEnabled && status?.native_enabled ? (
        <Text style={styles.terms}>
          Payment is charged by Apple or Google when you confirm. Subscriptions renew automatically unless cancelled through your store account before renewal. Restoring purchases never creates a new charge.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingBottom: 44 },
  eyebrow: { color: theme.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  title: { color: theme.text, fontSize: 28, fontWeight: '800', marginTop: 6 },
  copy: { color: theme.textSecondary, lineHeight: 21, marginTop: 8 },
  message: { color: theme.accent, lineHeight: 20, marginTop: 16 },
  spinner: { marginTop: 28 },
  stack: { gap: 14, marginTop: 24 },
  card: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 14, padding: 18, marginTop: 24 },
  cardTitle: { color: theme.text, fontSize: 18, fontWeight: '800' },
  price: { color: theme.text, fontSize: 20, fontWeight: '800', marginTop: 14 },
  primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent, borderRadius: 10, paddingHorizontal: 16, marginTop: 16 },
  primaryText: { color: theme.background, fontSize: 16, fontWeight: '800' },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 16 },
  secondaryText: { color: theme.text, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.72 },
  terms: { color: theme.textMuted, fontSize: 12, lineHeight: 18, marginTop: 24 },
  meter: { marginTop: 14 },
  meterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  meterLabel: { color: theme.text, fontSize: 14, fontWeight: '600' },
  meterValue: { color: theme.textSecondary, fontSize: 13, fontWeight: '600' },
  meterValueNearly: { color: theme.warning },
  track: { height: 6, borderRadius: 3, backgroundColor: theme.surfaceInteractive, overflow: 'hidden', marginTop: 8 },
  fill: { height: 6, borderRadius: 3, backgroundColor: theme.accent },
  fillNearly: { backgroundColor: theme.warning },
  meterHint: { color: theme.textMuted, fontSize: 12, marginTop: 5 },
});
