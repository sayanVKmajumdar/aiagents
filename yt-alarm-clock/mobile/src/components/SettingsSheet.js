import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import * as ApiService from '../services/ApiService';
import { colors, radius, spacing, typography } from '../theme';
import { isConfigured } from '../utils/storage';

/**
 * Server settings: backend URL + optional API key, with a live "Test" button.
 * Also shows the Android readiness checklist, because 90% of "my alarm didn't
 * ring" reports are OS battery optimisation, not app code.
 */
export default function SettingsSheet({
  serverUrl,
  apiKey,
  onSave,
  onClose,
  batteryHint,
}) {
  const [url, setUrl] = useState(serverUrl);
  const [key, setKey] = useState(apiKey);
  const [testState, setTestState] = useState({ status: 'idle', message: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setUrl(serverUrl);
    setKey(apiKey);
  }, [serverUrl, apiKey]);

  const test = async () => {
    if (!isConfigured(url)) {
      setTestState({
        status: 'error',
        message: 'Enter a full https:// URL (not the placeholder).',
      });
      return;
    }
    setTestState({ status: 'loading', message: 'Contacting backend…' });
    const result = await ApiService.ping(url, { apiKey: key });
    setTestState(
      result.ok
        ? {
            status: 'ok',
            message: `Backend online · auth: ${result.mode}${
              result.apiKeyRequired ? ' · key required' : ''
            }`,
          }
        : { status: 'error', message: result.message || 'Backend unreachable.' }
    );
  };

  const save = async () => {
    setSaving(true);
    await onSave({ serverUrl: url.trim(), apiKey: key.trim() });
    setSaving(false);
  };

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View style={styles.sheet}>
        <View style={styles.handle} />
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Server</Text>
          <Text style={styles.subtitle}>
            Point the app at your deployed backend. On a local network use your
            computer's LAN IP, e.g. http://192.168.1.20:8000
          </Text>

          <Text style={styles.label}>Backend URL</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://yt-alarm-backend.onrender.com"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />

          <Text style={styles.label}>API key (optional)</Text>
          <TextInput
            value={key}
            onChangeText={setKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="Only if ALARM_API_KEY is set on the server"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />

          <View style={styles.inlineRow}>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              onPress={test}
              disabled={testState.status === 'loading'}
            >
              {testState.status === 'loading' ? (
                <ActivityIndicator color={colors.text} size="small" />
              ) : (
                <Text style={styles.secondaryText}>Test connection</Text>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              onPress={save}
              disabled={saving}
            >
              <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>

          {testState.status !== 'idle' && testState.status !== 'loading' ? (
            <Text
              style={[
                styles.testResult,
                testState.status === 'ok' ? styles.testOk : styles.testError,
              ]}
            >
              {testState.message}
            </Text>
          ) : null}

          <View style={styles.divider} />

          <Text style={styles.title}>Android checklist</Text>
          <Text style={styles.subtitle}>
            Android kills background alarms unless you allow these. Do it once per
            install:
          </Text>
          {[
            'Battery usage → Unrestricted',
            'Alarms & reminders → Allowed',
            'Display over other apps → Allowed',
            'Notifications → Allowed (Alarms channel on)',
          ].map((item) => (
            <View key={item} style={styles.checkRow}>
              <Text style={styles.checkMark}>✓</Text>
              <Text style={styles.checkText}>{item}</Text>
            </View>
          ))}

          {batteryHint ? <Text style={styles.hint}>{batteryHint}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            onPress={onClose}
          >
            <Text style={styles.secondaryText}>Close</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 60,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg + 8,
    borderTopRightRadius: radius.lg + 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.title,
    fontSize: 22,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.caption,
    color: colors.textFaint,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    ...typography.body,
    fontSize: 14,
  },
  inlineRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    ...typography.body,
    color: colors.textMuted,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  primaryText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  testResult: {
    ...typography.body,
    fontSize: 13,
    marginTop: spacing.md,
  },
  testOk: { color: colors.success },
  testError: { color: colors.warning },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xl,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  checkMark: {
    color: colors.success,
    marginRight: spacing.sm,
    fontWeight: '700',
  },
  checkText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textMuted,
  },
  hint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textFaint,
    marginTop: spacing.md,
  },
  closeButton: {
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  pressed: { opacity: 0.8 },
});
