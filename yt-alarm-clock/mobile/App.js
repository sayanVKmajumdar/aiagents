import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import AlarmCard from './src/components/AlarmCard';
import RingingModal from './src/components/RingingModal';
import SettingsSheet from './src/components/SettingsSheet';
import SongPickerSheet from './src/components/SongPickerSheet';
import TimePickerSheet from './src/components/TimePickerSheet';
import useAlarmTrigger from './src/hooks/useAlarmTrigger';
import * as ApiService from './src/services/ApiService';
import * as AudioService from './src/services/AudioService';
import {
  cancelAlarmNotification,
  rescheduleAllAlarms,
  scheduleAlarmNotification,
  setupNotificationChannels,
} from './src/services/NotificationService';
import { colors, radius, spacing, typography } from './src/theme';
import { formatClock } from './src/utils/time';
import {
  createAlarm,
  isConfigured,
  loadAlarms,
  loadApiKey,
  loadServerUrl,
  saveAlarms,
  saveApiKey,
  saveServerUrl,
} from './src/utils/storage';

const KEEP_AWAKE_TAG = 'alarm-ringing';

export default function App() {
  return (
    <SafeAreaProvider>
      <AlarmApp />
    </SafeAreaProvider>
  );
}

function AlarmApp() {
  const [ready, setReady] = useState(false);
  const [alarms, setAlarms] = useState([]);
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [permissionGranted, setPermissionGranted] = useState(true);
  const [scheduleFailures, setScheduleFailures] = useState(0);
  const [serverStatus, setServerStatus] = useState({ ok: null, message: 'Checking…' });
  const [clock, setClock] = useState(() => new Date());

  // Which sheet is open: null | 'new' | 'song' | 'settings'
  const [sheet, setSheet] = useState(null);
  const [editingAlarm, setEditingAlarm] = useState(null);
  const [saving, setSaving] = useState(false);

  const alarmsRef = useRef([]);
  const commit = useCallback(async (next) => {
    alarmsRef.current = next;
    setAlarms(next);
    await saveAlarms(next);
  }, []);

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [storedAlarms, storedUrl, storedKey] = await Promise.all([
        loadAlarms(),
        loadServerUrl(),
        loadApiKey(),
      ]);
      if (cancelled) return;

      alarmsRef.current = storedAlarms;
      setAlarms(storedAlarms);
      setServerUrl(storedUrl);
      setApiKey(storedKey);

      const granted = await setupNotificationChannels();
      if (cancelled) return;
      setPermissionGranted(granted);

      // Notifications do not survive a reboot / reinstall, and their ids are
      // stale after an app update — re-arm everything on launch.
      if (granted && storedAlarms.length) {
        const { alarms: rescheduled, failed } = await rescheduleAllAlarms(storedAlarms);
        if (!cancelled) await commit(rescheduled);
        setScheduleFailures(failed);
      }

      setReady(true);

      // Warm a sleeping Render container while the user is still awake so the
      // 7 AM request is not a 30-second cold start.
      if (isConfigured(storedUrl)) {
        ApiService.warmUp(storedUrl, { apiKey: storedKey });
        const result = await ApiService.ping(storedUrl, { apiKey: storedKey });
        if (!cancelled) {
          setServerStatus({
            ok: result.ok,
            message: result.ok ? `online · ${result.mode}` : result.message || 'offline',
          });
        }
      } else {
        setServerStatus({ ok: false, message: 'not configured — open settings' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [commit]);

  // Wall clock in the header.
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 20000);
    return () => clearInterval(timer);
  }, []);

  // ---------------------------------------------------------------------
  // Ringing
  // ---------------------------------------------------------------------
  const handleDismissed = useCallback(() => {
    deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
  }, []);

  const { activeAlarm, dismiss } = useAlarmTrigger({ alarms, onDismissed: handleDismissed });

  useEffect(() => {
    if (!activeAlarm) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      AudioService.stop();
    };
  }, [activeAlarm]);

  // ---------------------------------------------------------------------
  // Alarm CRUD
  // ---------------------------------------------------------------------
  const armAlarm = useCallback(async (alarm) => {
    if (!alarm.enabled) return null;
    try {
      const id = await scheduleAlarmNotification(alarm);
      setScheduleFailures(0);
      return id;
    } catch (e) {
      Alert.alert(
        'Could not schedule alarm',
        'Android blocked this exact alarm. Open Settings → Apps → YT Alarm → ' +
          '"Alarms & reminders" and allow it, then toggle the alarm again.'
      );
      return null;
    }
  }, []);

  const upsertAlarm = useCallback(
    async ({ hour, minute, label, song }) => {
      setSaving(true);
      try {
        const existing = editingAlarm?.id
          ? alarmsRef.current.find((a) => a.id === editingAlarm.id)
          : null;

        const base = existing
          ? { ...existing, hour, minute, label, song: song !== undefined ? song : existing.song }
          : createAlarm({ hour, minute, label, song: song ?? editingAlarm?.song ?? null });

        if (existing) await cancelAlarmNotification(existing.id);

        const notificationId = await armAlarm(base);
        const saved = { ...base, notificationId };

        await commit(
          existing
            ? alarmsRef.current.map((a) => (a.id === saved.id ? saved : a))
            : [...alarmsRef.current, saved]
        );
        setSheet(null);
        setEditingAlarm(null);
      } finally {
        setSaving(false);
      }
    },
    [armAlarm, commit, editingAlarm]
  );

  const toggleAlarm = useCallback(
    async (alarm) => {
      const nextEnabled = !alarm.enabled;
      const updated = { ...alarm, enabled: nextEnabled, notificationId: null };
      await commit(alarmsRef.current.map((a) => (a.id === alarm.id ? updated : a)));

      if (nextEnabled) {
        const notificationId = await armAlarm(updated);
        await commit(
          alarmsRef.current.map((a) => (a.id === updated.id ? { ...a, notificationId } : a))
        );
      } else {
        await cancelAlarmNotification(updated.id);
      }
    },
    [armAlarm, commit]
  );

  const deleteAlarm = useCallback(async () => {
    if (!editingAlarm?.id) return;
    setSaving(true);
    try {
      await cancelAlarmNotification(editingAlarm.id);
      await commit(alarmsRef.current.filter((a) => a.id !== editingAlarm.id));
      setSheet(null);
      setEditingAlarm(null);
    } finally {
      setSaving(false);
    }
  }, [commit, editingAlarm]);

  const openNew = () => {
    setEditingAlarm(null);
    setSheet('new');
  };

  const openEdit = (alarm) => {
    setEditingAlarm(alarm);
    setSheet('new');
  };

  // ---------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------
  const saveSettings = async ({ serverUrl: url, apiKey: key }) => {
    const saved = await saveServerUrl(url);
    await saveApiKey(key);
    setServerUrl(saved || '');
    setApiKey(key);
    setSheet(null);

    if (!isConfigured(saved)) {
      setServerStatus({ ok: false, message: 'not configured — open settings' });
      return;
    }

    const result = await ApiService.ping(saved, { apiKey: key });
    setServerStatus({
      ok: result.ok,
      message: result.ok ? `online · ${result.mode}` : result.message || 'offline',
    });
    if (!result.ok) {
      Alert.alert('Backend unreachable', result.message || 'Check the URL and API key.');
    }
  };

  if (!ready) {
    return (
      <View style={styles.loading}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Waking up…</Text>
      </View>
    );
  }

  const activeCount = alarms.filter((a) => a.enabled).length;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>YT ALARM</Text>
          <Text style={styles.clock}>{formatClock(clock)}</Text>
        </View>
        <Pressable
          onPress={() => setSheet('settings')}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          accessibilityLabel="Server settings"
        >
          <Text style={styles.iconButtonText}>⚙︎</Text>
        </Pressable>
      </View>

      {!permissionGranted ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Notifications are blocked, so alarms cannot ring. Allow them in Android
            settings for YT Alarm.
          </Text>
        </View>
      ) : scheduleFailures > 0 ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {scheduleFailures} alarm{scheduleFailures > 1 ? 's' : ''} could not be
            scheduled. Allow "Alarms &amp; reminders" for YT Alarm, then toggle the
            alarm off and on again.
          </Text>
        </View>
      ) : null}

      <View style={styles.statusRow}>
        <View
          style={[
            styles.statusDot,
            serverStatus.ok === true && styles.statusDotOk,
            serverStatus.ok === false && styles.statusDotBad,
          ]}
        />
        <Text style={styles.statusText} numberOfLines={1}>
          Backend · {serverStatus.message}
        </Text>
      </View>

      <FlatList
        data={alarms}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <AlarmCard
            alarm={item}
            onToggle={() => toggleAlarm(item)}
            onPress={() => openEdit(item)}
          />
        )}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.sectionTitle}>Your alarms</Text>
            <Text style={styles.sectionHint}>
              {alarms.length === 0
                ? 'No alarms yet — try one 2 minutes from now to test.'
                : `${activeCount} active of ${alarms.length}`}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>⏰</Text>
            <Text style={styles.emptyTitle}>Nothing scheduled</Text>
            <Text style={styles.emptyBody}>
              Wake up to a random song from your Liked Songs. Nothing is downloaded —
              the alarm streams a fresh track every morning.
            </Text>
          </View>
        }
      />

      <Pressable
        onPress={openNew}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        accessibilityLabel="Add alarm"
      >
        <Text style={styles.fabText}>+  New alarm</Text>
      </Pressable>

      {sheet === 'new' ? (
        <TimePickerSheet
          initialAlarm={editingAlarm}
          busy={saving}
          onCancel={() => {
            setSheet(null);
            setEditingAlarm(null);
          }}
          onSubmit={upsertAlarm}
          onPickSong={() => setSheet('song')}
          onDelete={editingAlarm?.id ? deleteAlarm : undefined}
        />
      ) : null}

      {sheet === 'song' ? (
        <SongPickerSheet
          serverUrl={serverUrl}
          apiKey={apiKey}
          currentSong={editingAlarm?.song || null}
          onClose={() => setSheet('new')}
          onSelect={(song) => {
            setEditingAlarm((prev) => ({ ...(prev || {}), song }));
            setSheet('new');
          }}
        />
      ) : null}

      {sheet === 'settings' ? (
        <SettingsSheet
          serverUrl={serverUrl}
          apiKey={apiKey}
          onSave={saveSettings}
          onClose={() => setSheet(null)}
          batteryHint={
            Platform.OS === 'android'
              ? 'Xiaomi / Redmi / Poco: also enable Autostart and set the battery profile to "No restrictions".'
              : undefined
          }
        />
      ) : null}

      {activeAlarm ? (
        <RingingModal alarm={activeAlarm} config={{ serverUrl, apiKey }} onDismiss={dismiss} />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.body,
    color: colors.textMuted,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  eyebrow: {
    ...typography.caption,
    color: colors.accent,
  },
  clock: {
    fontSize: 46,
    fontWeight: '200',
    letterSpacing: -1.5,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  iconButtonText: {
    color: colors.text,
    fontSize: 20,
  },
  banner: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  bannerText: {
    ...typography.body,
    fontSize: 13,
    color: colors.text,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.textFaint,
    marginRight: spacing.sm,
  },
  statusDotOk: { backgroundColor: colors.success },
  statusDotBad: { backgroundColor: colors.warning },
  statusText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textFaint,
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: 140,
    flexGrow: 1,
  },
  listHeader: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.text,
  },
  sectionHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textFaint,
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl + spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.md },
  emptyTitle: { ...typography.heading, color: colors.text },
  emptyBody: {
    ...typography.body,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  fab: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  fabPressed: { opacity: 0.88 },
  fabText: {
    ...typography.heading,
    fontSize: 16,
    color: colors.text,
  },
  pressed: { opacity: 0.8 },
});
