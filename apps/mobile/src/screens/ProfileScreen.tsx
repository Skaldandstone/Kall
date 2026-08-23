import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchBrief } from '../api/brief';
import { useAuth } from '../auth/AuthContext';
import { theme } from '../theme';

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const [name, setName] = useState('');

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchBrief()
        .then((brief) => {
          if (!cancelled) setName(brief.user.preferred_name);
        })
        .catch(() => {
          // Non-critical: the greeting is a nicety, not required for this screen to work.
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Profile</Text>
      <Text style={styles.title}>{name ? `Hi, ${name}.` : 'Your account'}</Text>
      <Text style={styles.subtitle}>
        Manage professional profiles, resumes, and growth goals from the Kall web app.
      </Text>

      <Pressable style={styles.button} onPress={() => void signOut()}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background, paddingTop: 60, paddingHorizontal: 20 },
  eyebrow: { color: theme.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  title: { color: theme.text, fontSize: 26, fontWeight: '700', marginTop: 4 },
  subtitle: { color: theme.textSecondary, fontSize: 14, marginTop: 10, lineHeight: 20 },
  button: {
    marginTop: 32,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: { color: theme.text, fontWeight: '600' },
});
