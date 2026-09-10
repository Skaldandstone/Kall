import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ApiError } from "../api/client";
import { createRecord, deleteRecord, fetchRecords, updateRecord, type RecordRow } from "../api/record";
import { FormActions, FormField, SelectChips, SwitchRow, formStyles } from "../components/form";
import { DATE_PATTERN, RECORD_SCHEMAS, splitList, type RecordField } from "../lib/recordSchema";
import type { ProfileStackParamList } from "../navigation/types";
import { theme } from "../theme";

type Props = NativeStackScreenProps<ProfileStackParamList, "RecordResource">;
type Values = Record<string, string | boolean>;

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function initialValues(fields: readonly RecordField[], row?: RecordRow): Values {
  const values: Values = {};
  for (const field of fields) {
    const raw = row?.[field.name];
    if (field.kind === "checkbox") values[field.name] = Boolean(raw);
    else if (field.sensitive) values[field.name] = "";
    else if (field.kind === "list") values[field.name] = Array.isArray(raw) ? raw.join(", ") : "";
    else values[field.name] = raw === null || raw === undefined ? "" : String(raw);
  }
  return values;
}

function buildData(fields: readonly RecordField[], values: Values): { data: Record<string, unknown> } | { error: string } {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (field.kind === "checkbox") { data[field.name] = Boolean(raw); continue; }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (field.sensitive) {
      // Write-only: an empty box means "leave whatever is stored", not "erase".
      if (text) data[field.name] = text;
      continue;
    }
    if (!text) {
      if (field.required) return { error: `${field.label} is required.` };
      data[field.name] = field.kind === "list" ? [] : null;
      continue;
    }
    if (field.kind === "list") data[field.name] = splitList(text);
    else if (field.kind === "number") {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) return { error: `${field.label} must be a number.` };
      data[field.name] = parsed;
    } else if (field.kind === "date") {
      if (!DATE_PATTERN.test(text)) return { error: `${field.label} must be written as YYYY-MM-DD.` };
      data[field.name] = text;
    } else data[field.name] = text;
  }
  return { data };
}

function rowTitle(fields: readonly RecordField[], titleFields: readonly string[], row: RecordRow) {
  const parts = titleFields.map((name) => row[name]).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return parts.join(" · ") || `${humanize(fields[0].label)} #${row.id}`;
}

function rowDetail(fields: readonly RecordField[], titleFields: readonly string[], row: RecordRow) {
  return fields
    .filter((field) => !titleFields.includes(field.name) && !field.sensitive && (field.kind === "text" || field.kind === "date" || field.kind === "select"))
    .map((field) => row[field.name])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .slice(0, 2)
    .join(" · ");
}

export default function RecordResourceScreen({ route }: Props) {
  const { resource } = route.params;
  const schema = RECORD_SCHEMAS[resource];
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id: number | null; values: Values } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await fetchRecords(resource));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to load this section.");
    } finally {
      setLoading(false);
    }
  }, [resource]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function save() {
    if (!editing) return;
    const built = buildData(schema.fields, editing.values);
    if ("error" in built) {
      setMessage(built.error);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      if (editing.id === null) await createRecord(resource, built.data);
      else await updateRecord(resource, editing.id, built.data);
      setEditing(null);
      await load();
      setMessage(`${humanize(schema.singular)} saved.`);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : `Unable to save this ${schema.singular}.`);
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(row: RecordRow) {
    Alert.alert(`Delete this ${schema.singular}?`, rowTitle(schema.fields, schema.titleFields, row), [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteRecord(resource, row.id);
            await load();
            setMessage(`${humanize(schema.singular)} deleted.`);
          } catch (error) {
            setMessage(error instanceof ApiError ? error.message : "Unable to delete that entry.");
          }
        },
      },
    ]);
  }

  if (!schema) {
    return <View style={[styles.container, styles.centered]}><Text style={formStyles.body}>Unknown record section.</Text></View>;
  }
  if (loading) {
    return <View style={[styles.container, styles.centered]}><ActivityIndicator color={theme.text} accessibilityLabel={`Loading ${schema.label}`} /></View>;
  }

  const setValue = (name: string, value: string | boolean) =>
    setEditing((current) => current && { ...current, values: { ...current.values, [name]: value } });

  return (
    <KeyboardAvoidingView style={styles.container} behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={88}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <Text style={styles.subtitle}>{schema.description}</Text>
        {message ? <Text style={message.includes("saved") || message.includes("deleted") ? formStyles.success : formStyles.error}>{message}</Text> : null}

        {editing ? (
          <View style={formStyles.card}>
            <Text style={formStyles.cardLabel}>{editing.id === null ? `New ${schema.singular}` : `Edit ${schema.singular}`}</Text>
            {schema.fields.map((field) => {
              const value = editing.values[field.name];
              if (field.kind === "checkbox") {
                return <SwitchRow key={field.name} label={field.label} value={Boolean(value)} onChange={(next) => setValue(field.name, next)} />;
              }
              if (field.kind === "select") {
                return (
                  <SelectChips
                    key={field.name}
                    label={field.required ? `${field.label} *` : field.label}
                    value={typeof value === "string" && value ? value : null}
                    options={(field.options ?? []).map((option) => ({ value: option, label: humanize(option) }))}
                    onChange={(next) => setValue(field.name, next ?? "")}
                    help={field.help}
                  />
                );
              }
              return (
                <FormField
                  key={field.name}
                  label={field.required ? `${field.label} *` : field.label}
                  value={typeof value === "string" ? value : ""}
                  onChange={(next) => setValue(field.name, next)}
                  multiline={field.kind === "textarea"}
                  keyboardType={field.kind === "number" ? "decimal-pad" : field.kind === "date" ? "numbers-and-punctuation" : "default"}
                  autoCapitalize={field.kind === "date" || field.kind === "number" || field.name.includes("url") || field.name.includes("email") ? "none" : "sentences"}
                  placeholder={field.kind === "date" ? "2024-06-30" : undefined}
                  help={field.sensitive ? `${field.help ? `${field.help} ` : ""}Stored encrypted and never shown again. Leave blank to keep what is saved.` : field.help}
                />
              );
            })}
            <FormActions>
              <Pressable accessibilityRole="button" disabled={saving} style={[formStyles.primary, saving && formStyles.disabled]} onPress={() => void save()}>
                {saving ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>Save {schema.singular}</Text>}
              </Pressable>
              <Pressable accessibilityRole="button" disabled={saving} style={formStyles.secondary} onPress={() => setEditing(null)}>
                <Text style={formStyles.secondaryText}>Cancel</Text>
              </Pressable>
            </FormActions>
          </View>
        ) : (
          <Pressable accessibilityRole="button" style={[formStyles.primary, styles.addButton]} onPress={() => setEditing({ id: null, values: initialValues(schema.fields) })}>
            <Text style={formStyles.primaryText}>Add {schema.singular}</Text>
          </Pressable>
        )}

        {rows.length === 0 && !editing ? (
          <View style={formStyles.card}><Text style={formStyles.body}>Nothing saved here yet.</Text></View>
        ) : null}
        {rows.map((row) => {
          const detail = rowDetail(schema.fields, schema.titleFields, row);
          return (
            <View key={row.id} style={formStyles.card}>
              <Text style={formStyles.cardTitle}>{rowTitle(schema.fields, schema.titleFields, row)}</Text>
              {detail ? <Text style={formStyles.body}>{detail}</Text> : null}
              <FormActions>
                <Pressable accessibilityRole="button" style={formStyles.secondary} onPress={() => { setMessage(""); setEditing({ id: row.id, values: initialValues(schema.fields, row) }); }}>
                  <Text style={formStyles.secondaryText}>Edit</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={formStyles.secondary} onPress={() => confirmDelete(row)}>
                  <Text style={formStyles.dangerText}>Delete</Text>
                </Pressable>
              </FormActions>
            </View>
          );
        })}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 48 },
  subtitle: { color: theme.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  addButton: { marginBottom: 14 },
});
