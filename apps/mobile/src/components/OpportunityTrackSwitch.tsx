import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

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
        icon="briefcase-outline"
        selected={active === 'jobs'}
        onPress={() => onSelect('jobs')}
      />
      <TrackButton
        label="Consulting"
        icon="people-outline"
        selected={active === 'consulting'}
        onPress={() => onSelect('consulting')}
      />
    </View>
  );
}

function TrackButton({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      aria-selected={selected}
      style={[styles.button, selected && styles.buttonSelected]}
      onPress={onPress}
    >
      <Ionicons accessible={false} name={icon} size={17} color={selected ? theme.accentInk : theme.textMuted} />
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 5,
    padding: 5,
    borderRadius: 16,
    backgroundColor: theme.backgroundSoft,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 10,
  },
  buttonSelected: { backgroundColor: theme.accent },
  label: { color: theme.textSecondary, fontSize: 13, fontWeight: '600' },
  labelSelected: { color: theme.accentInk },
});
