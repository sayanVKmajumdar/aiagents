import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import * as AudioService from '../services/AudioService';
import { colors, radius, spacing, typography } from '../theme';
import { formatDuration } from '../utils/time';

const TICK_MS = 400;

/**
 * The "you must listen to the whole song" screen.
 *
 * - Mounts full screen over the lockscreen (native flags in
 *   plugins/withAndroidAlarmFlags.js make this visible while the phone is locked).
 * - Streams a random song through AudioService, looping until the user dismisses.
 * - The dismiss button stays disabled until the configured share of the track has
 *   played (default 100%). If playback fails, an escape hatch appears after a
 *   while so the user is never trapped by a broken stream.
 */
export default function RingingModal({
  alarm,
  config,
  onDismiss,
  requiredProgress = 1,
  onPlaybackError,
}) {
  const [track, setTrack] = useState(null);
  const [playback, setPlayback] = useState({
    progress: 0,
    currentTime: 0,
    duration: 0,
    playing: false,
    isBuffering: false,
  });
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('loading');
  const [usingFallback, setUsingFallback] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [elapsed, setElapsed] = useState(0);

  const buttonScale = useRef(new Animated.Value(1)).current;
  const startedAtRef = useRef(Date.now());

  // The parent re-renders (clock ticks, sheets opening) and creates a new
  // `config` object every time. Holding it in a ref keeps `startPlayback`
  // stable so the song is never restarted mid-alarm.
  const configRef = useRef(config);
  configRef.current = config;

  // ---------------------------------------------------------------------
  // Start playback
  // ---------------------------------------------------------------------
  const startPlayback = useCallback(
    async (useSong = true) => {
      setStatus('loading');
      setError(null);
      try {
        const { track: fetched, fallback } = await AudioService.play({
          song: useSong ? alarm?.song : null,
          config: configRef.current,
        });
        setTrack(fetched);
        setUsingFallback(Boolean(fallback));
        setStatus('playing');
      } catch (e) {
        setStatus('error');
        setError(e.message || 'Could not reach the alarm server.');
        onPlaybackError?.(e);
      }
    },
    [alarm?.song, onPlaybackError]
  );

  // Runs once per ringing session: `startPlayback` is stable (see configRef).
  useEffect(() => {
    startPlayback(true);
    startedAtRef.current = Date.now();

    return () => {
      AudioService.stop();
    };
  }, [startPlayback]);

  // Poll the player: expo-audio's status events are reliable, but polling keeps
  // the UI honest even if a re-render drops an event.
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const interval = setInterval(() => {
      const state = AudioService.getPlaybackState();
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setPlayback(state);
      setElapsed(seconds);

      // A stream that never loads (killed by the OS after doze) must not leave
      // the user staring at a silent screen: surface the failure.
      if (
        statusRef.current === 'playing' &&
        !state.isLoaded &&
        !state.isBuffering &&
        seconds > 20
      ) {
        setStatus('error');
        setError('The stream stalled. Check your connection, then retry.');
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  // Wall clock + a heartbeat pulse on the alarm icon.
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(buttonScale, {
          toValue: 1.06,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(buttonScale, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [buttonScale]);

  // ---------------------------------------------------------------------
  // Dismiss gating
  // ---------------------------------------------------------------------
  const requiredSeconds = playback.duration
    ? playback.duration * requiredProgress
    : 0;
  // A streamed track must be listened to (nearly) all the way through. The
  // offline tone has no duration, so require a short fixed listen instead.
  const listenedEnough = usingFallback
    ? elapsed >= 20
    : playback.progress >= requiredProgress && Boolean(playback.duration);
  // Escape hatch: 90s after a hard failure the user may leave regardless.
  const escapeHatch = status === 'error' && elapsed > 90;
  const canDismiss = listenedEnough || escapeHatch;

  const handleDismiss = () => {
    if (!canDismiss) return;
    AudioService.stop();
    onDismiss?.();
  };

  const retry = async () => {
    setError(null);
    setStatus('loading');
    try {
      const { track: fetched, fallback } = await AudioService.restart({
        song: alarm?.song,
        config: configRef.current,
        allowFallback: true,
      });
      setTrack(fetched);
      setUsingFallback(Boolean(fallback));
      setStatus('playing');
      startedAtRef.current = Date.now();
    } catch (e) {
      setStatus('error');
      setError(e.message || 'Retry failed.');
    }
  };

  const remaining =
    requiredSeconds > 0
      ? Math.max(0, requiredSeconds - playback.currentTime)
      : 0;

  const timeLabel = now.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={styles.container} accessibilityViewIsModal>
      <View style={styles.header}>
        <Text style={styles.clock}>{timeLabel}</Text>
        <Text style={styles.alarmLabel}>{alarm?.label || 'Wake up'}</Text>
      </View>

      <Animated.View style={[styles.badge, { transform: [{ scale: buttonScale }] }]}>
        <Text style={styles.badgeEmoji}>⏰</Text>
      </Animated.View>

      {usingFallback ? (
        <Text style={styles.fallbackNotice}>
          Backend unreachable — ringing with the built-in tone.
        </Text>
      ) : null}

      <View style={styles.trackBlock}>
        <Text style={styles.trackTitle} numberOfLines={2}>
          {track?.title || 'Finding your song…'}
        </Text>
        <Text style={styles.trackArtist} numberOfLines={1}>
          {track?.artist || 'YouTube Music'}
        </Text>
      </View>

      <View style={styles.progressBlock}>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.min(100, Math.round(playback.progress * 100))}%` },
            ]}
          />
        </View>
        <View style={styles.progressMeta}>
          <Text style={styles.progressText}>
            {formatDuration(playback.currentTime)} / {formatDuration(playback.duration)}
          </Text>
          <Text style={styles.progressText}>
            {playback.isBuffering && status === 'playing'
              ? 'buffering…'
              : canDismiss
                ? 'ready'
                : `${formatDuration(remaining)} left`}
          </Text>
        </View>
      </View>

      {status === 'error' ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorTitle}>Playback problem</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        onPress={handleDismiss}
        disabled={!canDismiss}
        style={({ pressed }) => [
          styles.dismissButton,
          !canDismiss && styles.dismissDisabled,
          pressed && canDismiss && styles.dismissPressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canDismiss }}
        accessibilityLabel={canDismiss ? 'Dismiss alarm' : 'Listen to the full song to dismiss'}
      >
        <Text style={[styles.dismissText, !canDismiss && styles.dismissTextDisabled]}>
          {canDismiss
            ? 'DISMISS'
            : status === 'loading'
              ? 'CONNECTING…'
              : escapeHatch
                ? 'DISMISS ANYWAY'
                : 'LISTEN TO DISMISS'}
        </Text>
      </Pressable>

      <Text style={styles.hint}>
        {canDismiss
          ? 'Have a good day.'
          : `Keep the song playing — ${Math.max(
              0,
              Math.round(playback.progress * 100)
            )}% listened.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: 72,
    paddingBottom: 56,
    zIndex: 100,
  },
  header: {
    alignItems: 'center',
  },
  clock: {
    ...typography.display,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  alarmLabel: {
    ...typography.caption,
    color: colors.accent,
    marginTop: spacing.xs,
  },
  badge: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeEmoji: {
    fontSize: 56,
  },
  fallbackNotice: {
    ...typography.caption,
    color: colors.warning,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  trackBlock: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  trackTitle: {
    ...typography.title,
    color: colors.text,
    textAlign: 'center',
  },
  trackArtist: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  progressBlock: {
    width: '100%',
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  progressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  progressText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textFaint,
    fontVariant: ['tabular-nums'],
  },
  errorBlock: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
  },
  errorTitle: {
    ...typography.heading,
    color: colors.warning,
  },
  errorText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  retryButton: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  retryText: {
    ...typography.body,
    color: colors.text,
  },
  dismissButton: {
    width: '100%',
    paddingVertical: spacing.lg + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  dismissDisabled: {
    backgroundColor: colors.surfaceRaised,
  },
  dismissPressed: {
    opacity: 0.85,
  },
  dismissText: {
    ...typography.heading,
    letterSpacing: 2,
    color: colors.text,
  },
  dismissTextDisabled: {
    color: colors.textFaint,
  },
  hint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textFaint,
    textAlign: 'center',
  },
});
