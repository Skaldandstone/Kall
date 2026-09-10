import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { theme } from "../theme";

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
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ false: theme.border, true: theme.accent }} />
    </View>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

export const formStyles = StyleSheet.create({
  primary: { minHeight: 48, alignItems: "center", justifyContent: "center", backgroundColor: theme.accent, borderRadius: 10, paddingHorizontal: 16 },
  primaryText: { color: theme.accentInk, fontWeight: "700", fontSize: 14 },
  secondary: { minHeight: 48, alignItems: "center", justifyContent: "center", borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14 },
  secondaryText: { color: theme.text, fontWeight: "700", fontSize: 14 },
  dangerText: { color: theme.danger, fontWeight: "700", fontSize: 14 },
  disabled: { opacity: 0.5 },
  card: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 14 },
  cardLabel: { color: theme.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginBottom: 8 },
  cardTitle: { color: theme.text, fontSize: 17, fontWeight: "700" },
  body: { color: theme.textSecondary, fontSize: 14, lineHeight: 20 },
  muted: { color: theme.textMuted, fontSize: 12, lineHeight: 17 },
  success: { color: theme.success, marginBottom: 14, lineHeight: 20 },
  error: { color: theme.danger, marginBottom: 14, lineHeight: 20 },
});

const styles = StyleSheet.create({
  field: { marginTop: 12 },
  label: { color: theme.textSecondary, fontSize: 13, fontWeight: "600", marginBottom: 6 },
  input: { minHeight: 48, color: theme.text, backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, fontSize: 15 },
  inputDisabled: { opacity: 0.6 },
  multiline: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
  help: { color: theme.textMuted, fontSize: 12, lineHeight: 17, marginTop: 5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 40, justifyContent: "center", borderColor: theme.border, borderWidth: 1, borderRadius: 20, paddingHorizontal: 13 },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: theme.accentInk },
  switchRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  switchCopy: { flex: 1 },
  switchLabel: { color: theme.text, fontSize: 15, fontWeight: "600" },
  disabled: { opacity: 0.55 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
});
