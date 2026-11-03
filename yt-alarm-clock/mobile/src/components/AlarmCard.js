import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { describeCountdown, formatTime } from '../utils/time';

/**
 * One alarm row: big time, label, song hint, countdown and an on/off switch.
 * Tapping the body edits; tapping the switch only toggles.
 */
export default function AlarmCard({ alarm, onToggle, onPress }) {
  const { hour, minute, label, song, enabled } = alarm;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Alarm at ${formatTime(hour, minute)}${label ? `, ${label}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        !enabled && styles.cardDisabled,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.row}>
        <View style={styles.timeColumn}>
          <Text style={[styles.time, !enabled && styles.textDisabled]}>
            {formatTime(hour, minute)}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {enabled ? describeCountdown(hour, minute) : 'off'}
            {label ? ` · ${label}` : ''}
          </Text>
        </View>

        <Switch
          value={enabled}
          onValueChange={onToggle}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={colors.text}
          ios_backgroundColor={colors.border}
        />
      </View>

      <View style={styles.songRow}>
        <View style={styles.songDot} />
        <Text style={styles.songText} numberOfLines={1}>
          {song?.title ? `${song.title}` : 'Random song from your Liked Songs'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    marginBottom: spacing.md,
  },
  cardDisabled: {
    backgroundColor: '#0f0f12',
  },
  cardPressed: {
    borderColor: colors.accentSoft,
    transform: [{ scale: 0.995 }],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeColumn: {
    flex: 1,
    marginRight: spacing.md,
  },
  time: {
    fontSize: 42,
    fontWeight: '300',
    letterSpacing: -1.5,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  textDisabled: {
    color: colors.textFaint,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: 2,
  },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  songDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginRight: spacing.sm,
  },
  songText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textFaint,
    flex: 1,
  },
});
