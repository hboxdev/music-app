import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from './theme';

// A small dialog with one or more text fields.
// prompt = { title, fields: [{ key, label, value }], submitLabel, onSubmit(values) }
export default function PromptModal({ prompt, onClose }) {
  const [values, setValues] = useState({});

  useEffect(() => {
    if (prompt) {
      setValues(Object.fromEntries(prompt.fields.map((f) => [f.key, f.value || ''])));
    }
  }, [prompt]);

  if (!prompt) return null;

  const firstKey = prompt.fields[0].key;
  const canSubmit = (values[firstKey] || '').trim().length > 0;
  const submit = () => {
    if (!canSubmit) return;
    onClose();
    prompt.onSubmit(values);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.box}>
          <Text style={styles.title}>{prompt.title}</Text>
          {prompt.fields.map((f, i) => (
            <View key={f.key}>
              {f.label ? <Text style={styles.label}>{f.label}</Text> : null}
              <TextInput
                style={styles.input}
                value={values[f.key] ?? ''}
                onChangeText={(t) => setValues((v) => ({ ...v, [f.key]: t }))}
                autoFocus={i === 0}
                placeholderTextColor={colors.muted}
                returnKeyType={i === prompt.fields.length - 1 ? 'done' : 'next'}
                onSubmitEditing={i === prompt.fields.length - 1 ? submit : undefined}
              />
            </View>
          ))}
          <View style={styles.buttons}>
            <Pressable onPress={onClose} style={styles.btn}>
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              style={[styles.btn, styles.primary, !canSubmit && { opacity: 0.5 }]}
            >
              <Text style={[styles.btnText, styles.primaryText]}>
                {prompt.submitLabel || 'Save'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  box: { backgroundColor: colors.panel, borderRadius: 16, padding: 20 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  label: { color: colors.muted, fontSize: 13, marginTop: 8, marginBottom: 6 },
  input: {
    backgroundColor: colors.bg,
    color: colors.text,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  btnText: { color: colors.text, fontWeight: '600' },
  primary: { backgroundColor: colors.accent },
  primaryText: { color: '#fff' },
});
