import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { formatTime, toDate } from '../utils/time';

/**
 * Bottom sheet used both to create and to edit an alarm.
 * Keeps its own draft state so the list never sees half-edited values.
 */
export default function TimePickerSheet({
  initialAlarm,
  onSubmit,
  onCancel,
  onPickSong,
  onDelete,
  busy,
}) {
  const fallback = useMemo(() => {
    const now = new Date();
    // Default a new alarm to one minute from now: the quickest way to test.
    now.setMinutes(now.getMinutes() + 1);
    return { hour: now.getHours(), minute: now.getMinutes() };
  }, []);

  const [date, setDate] = useState(() =>
    toDate(
      initialAlarm?.hour ?? fallback.hour,
      initialAlarm?.minute ?? fallback.minute
    )
  );
  const [label, setLabel] = useState(initialAlarm?.label || '');
  const [showPicker, setShowPicker] = useState(Platform.OS === 'ios' || !initialAlarm);

  const handleChange = (event, selected) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event?.type === 'dismissed' || !selected) return;
    setDate(selected);
  };

  const submit = () => {
    onSubmit({
      hour: date.getHours(),
      minute: date.getMinutes(),
      label: label.trim(),
    });
  };

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="Cancel" />

      <View style={styles.sheet}>
        <View style={styles.handle} />

        <Text style={styles.sheetTitle}>
          {initialAlarm ? 'Edit alarm' : 'New alarm'}
        </Text>
        <Text style={styles.sheetSubtitle}>
          {initialAlarm
            ? 'Change the time or label. The song stays as it is.'
            : 'Pick a time — the song is chosen randomly when it rings.'}
        </Text>

        <Pressable style={styles.timeButton} onPress={() => setShowPicker(true)}>
          <Text style={styles.timeText}>
            {formatTime(date.getHours(), date.getMinutes())}
          </Text>
          <Text style={styles.timeHint}>tap to change</Text>
        </Pressable>

        {showPicker ? (
          <DateTimePicker
            value={date}
            mode="time"
            is24Hour
            display={Platform.OS === 'ios' ? 'spinner' : 'clock'}
            themeVariant="dark"
            onChange={handleChange}
          />
        ) : null}

        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder="Label (optional) — e.g. Gym"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          maxLength={40}
          returnKeyType="done"
        />

        <Pressable
          style={({ pressed }) => [styles.songRow, pressed && styles.pressed]}
          onPress={onPickSong}
        >
          <Text style={styles.songEmoji}>🎵</Text>
          <View style={styles.flex}>
            <Text style={styles.songTitle} numberOfLines={1}>
              {initialAlarm?.song?.title || 'Surprise me'}
            </Text>
            <Text style={styles.songHint}>
              {initialAlarm?.song?.title
                ? initialAlarm.song.artist || 'Pinned song'
                : 'Random track from Liked Songs / charts'}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            onPress={onCancel}
            disabled={busy}
          >
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              busy && styles.primaryDisabled,
              pressed && styles.pressed,
            ]}
            onPress={submit}
            disabled={busy}
          >
            <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save alarm'}</Text>
          </Pressable>
        </View>

        {initialAlarm && onDelete ? (
          <Pressable
            style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
            onPress={onDelete}
            disabled={busy}
          >
            <Text style={styles.deleteText}>Delete alarm</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 50,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg + 8,
    borderTopRightRadius: radius.lg + 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  sheetTitle: {
    ...typography.title,
    color: colors.text,
  },
  sheetSubtitle: {
    ...typography.body,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  timeButton: {
    alignSelf: 'center',
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  timeText: {
    fontSize: 60,
    fontWeight: '200',
    letterSpacing: -2,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  timeHint: {
    ...typography.caption,
    color: colors.textFaint,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    ...typography.body,
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  songEmoji: { fontSize: 18, marginRight: spacing.md },
  songTitle: { ...typography.body, color: colors.text },
  songHint: { ...typography.body, fontSize: 12, color: colors.textFaint },
  chevron: { color: colors.textFaint, fontSize: 22, marginLeft: spacing.sm },
  flex: { flex: 1 },
  deleteButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  deleteText: { ...typography.body, color: colors.accent },
  secondaryButton: {
    flex: 1,
    paddingVertical: spacing.md + 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  secondaryText: {
    ...typography.body,
    color: colors.textMuted,
  },
  primaryButton: {
    flex: 2,
    paddingVertical: spacing.md + 4,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  primaryDisabled: {
    opacity: 0.6,
  },
  primaryText: {
    ...typography.heading,
    fontSize: 16,
    color: colors.text,
  },
  pressed: {
    opacity: 0.8,
  },
});
