import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import { fetchBillingStatus, type BillingStatus } from '../api/billing';
import { mobilePurchasesEnabled } from '../components/PurchaseBootstrap';
import { theme } from '../theme';

const WEB_BILLING_URL = 'https://kall.skaldandstone.com/billing';

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/cancel/i.test(message)) return '';
  return 'The store could not complete that request. Please try again.';
}

export default function BillingScreen() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const purchasesEnabled = mobilePurchasesEnabled();

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const nextStatus = await fetchBillingStatus();
      setStatus(nextStatus);
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
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Manage on the web</Text>
          <Text style={styles.copy}>Review Kall plans and manage your current subscription securely.</Text>
          <Pressable
            accessibilityRole="link"
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            onPress={() => void Linking.openURL(WEB_BILLING_URL)}
          >
            <Text style={styles.primaryText}>Open plan and billing</Text>
          </Pressable>
        </View>
      )}
      <Text style={styles.terms}>
        Payment is charged by Apple or Google when you confirm. Subscriptions renew automatically unless cancelled through your store account before renewal. Restoring purchases never creates a new charge.
      </Text>
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
});
