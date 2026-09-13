import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { elevation, radius, spacing, theme, type } from "../theme";

export function FormField({ label, value, onChange, placeholder, help, multiline = false, keyboardType = "default", autoCapitalize = "sentences", secure = false, editable = true }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  help?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  secure?: boolean;
  editable?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={[styles.input, multiline && styles.multiline, !editable && styles.inputDisabled]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secure}
        editable={editable}
      />
      {help ? <Text style={styles.help}>{help}</Text> : null}
    </View>
  );
}

export function SelectChips({ label, value, options, onChange, help }: {
  label: string;
  value: string | null;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string | null) => void;
  help?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              style={[styles.chip, selected && styles.chipActive]}
              onPress={() => onChange(selected ? null : option.value)}
            >
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {help ? <Text style={styles.help}>{help}</Text> : null}
    </View>
  );
}

export function SwitchRow({ label, detail, value, onChange, disabled = false }: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.switchRow, disabled && styles.disabled]}>
      <View style={styles.switchCopy}>
        <Text style={styles.switchLabel}>{label}</Text>
        {detail ? <Text style={styles.help}>{detail}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={detail}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: theme.border, true: theme.accent }}
      />
    </View>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

export const formStyles = StyleSheet.create({
  primary: { minHeight: 50, alignItems: "center", justifyContent: "center", backgroundColor: theme.accent, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  primaryText: { color: theme.accentInk, fontWeight: "800", fontSize: type.body },
  secondary: { minHeight: 48, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceRaised, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  secondaryText: { color: theme.text, fontWeight: "700", fontSize: type.body },
  dangerText: { color: theme.danger, fontWeight: "700", fontSize: type.body },
  disabled: { opacity: 0.5 },
  card: { ...elevation.card, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  cardLabel: { color: theme.accent, fontSize: 11, lineHeight: 15, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: spacing.sm },
  cardTitle: { color: theme.text, fontSize: type.title, lineHeight: 24, fontWeight: "700", letterSpacing: -0.25 },
  body: { color: theme.textSecondary, fontSize: type.body, lineHeight: 22 },
  muted: { color: theme.textMuted, fontSize: 13, lineHeight: 18 },
  success: { color: theme.success, marginBottom: spacing.md, fontSize: 14, lineHeight: 20 },
  error: { color: theme.danger, marginBottom: spacing.md, fontSize: 14, lineHeight: 20 },
});

const styles = StyleSheet.create({
  field: { marginTop: spacing.md },
  label: { color: theme.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: "600", marginBottom: 6 },
  input: { minHeight: 52, color: theme.text, backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg, fontSize: 16 },
  inputDisabled: { opacity: 0.6 },
  multiline: { minHeight: 104, paddingTop: spacing.md, textAlignVertical: "top" },
  help: { color: theme.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 44, justifyContent: "center", borderColor: theme.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14 },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  chipTextActive: { color: theme.accentInk },
  switchRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm },
  switchCopy: { flex: 1 },
  switchLabel: { color: theme.text, fontSize: 15, fontWeight: "600" },
  disabled: { opacity: 0.55 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
});
