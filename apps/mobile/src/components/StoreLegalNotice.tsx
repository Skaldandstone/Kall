import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

const PRIVACY_URL = 'https://kall.skaldandstone.com/privacy-policy';
const TERMS_URL = 'https://kall.skaldandstone.com/terms';

function LegalLink({ label, url }: { label: string; url: string }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`Open ${label}`} onPress={() => void Linking.openURL(url)}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

export default function StoreLegalNotice() {
  return (
    <View style={styles.container}>
      <Text style={styles.copy}>
        Payment is charged to your app store account when you confirm. Subscriptions renew automatically unless cancelled through your store account before renewal. Restoring purchases never creates a new charge.
      </Text>
      <View style={styles.links}>
        <LegalLink label="Privacy Policy" url={PRIVACY_URL} />
        <Text style={styles.separator}>•</Text>
        <LegalLink label="Terms of Use" url={TERMS_URL} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 24 },
  copy: { color: theme.textMuted, fontSize: 12, lineHeight: 18 },
  links: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
  link: { color: theme.accent, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  separator: { color: theme.textMuted, fontSize: 12 },
});
