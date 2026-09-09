import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

type Track = 'jobs' | 'consulting';

export default function OpportunityTrackSwitch({
  active,
  onSelect,
}: {
  active: Track;
  onSelect: (track: Track) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Choose a work search track"
      style={styles.container}
    >
      <TrackButton
        label="Job search"
        selected={active === 'jobs'}
        onPress={() => onSelect('jobs')}
      />
      <TrackButton
        label="Consulting"
        selected={active === 'consulting'}
        onPress={() => onSelect('consulting')}
      />
    </View>
  );
}

function TrackButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      aria-selected={selected}
      style={[styles.button, selected && styles.buttonSelected]}
      onPress={onPress}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 6,
    padding: 4,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
  },
  button: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    paddingHorizontal: 10,
  },
  buttonSelected: { backgroundColor: theme.accent },
  label: { color: theme.textSecondary, fontWeight: '700' },
  labelSelected: { color: theme.accentInk },
});
