import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { nextOccurrence } from '../utils/time';

export const ALARM_CHANNEL_ID = 'alarm-high-priority';
export const ALARM_CATEGORY_ID = 'alarm';
const ALARM_NOTIFICATION_TYPE = 'yt-alarm';

/**
 * The handler decides what happens when a notification arrives while the app is
 * in the foreground. We deliberately do NOT play a sound here: the ringing
 * screen starts the music itself and the OS channel handles sound/vibration
 * when the app is backgrounded.
 */
Notifications.setNotificationHandler({
  // expo-notifications 0.32 requires shouldShowBanner/shouldShowList;
  // shouldShowAlert is kept for older SDKs that still read it.
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

/**
 * Create the Android channel, register the "alarm" category with a
 * "Stop alarm" action, and ask for notification permission.
 *
 * @returns {Promise<boolean>} whether notifications are permitted
 */
export const setupNotificationChannels = async () => {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
      name: 'Unstoppable Alarms',
      description: 'Wake-up alarms that ring over the lock screen',
      importance: Notifications.AndroidImportance.MAX,
      // Must be non-empty for Android to treat this as an alarm channel.
      vibrationPattern: [0, 500, 250, 500, 250, 500],
      lightColor: '#FF0033',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      // `sound: null` keeps the music in the app; the channel still vibrates.
      sound: null,
      enableVibrate: true,
      enableLights: true,
      showBadge: false,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
    });
  }

  // Lets the user dismiss from the notification shade without unlocking.
  await Notifications.setNotificationCategoryAsync(ALARM_CATEGORY_ID, [
    {
      identifier: 'STOP_ALARM',
      buttonTitle: 'Stop alarm',
      options: { opensAppToForeground: true, isDestructive: true },
    },
  ]);

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowSound: true,
        allowBadge: false,
        allowCriticalAlerts: true,
      },
    });
    finalStatus = status;
  }
  return finalStatus === 'granted';
};

/**
 * Schedule (or reschedule) the OS notification that triggers an alarm.
 * Android fires it as a full-screen alarm notification thanks to
 * plugins/withFullScreenAlarmNotification.js.
 *
 * @returns {Promise<string|null>} the notification identifier
 */
export const scheduleAlarmNotification = async (alarm) => {
  await cancelAlarmNotification(alarm.id);
  if (!alarm.enabled) return null;

  const fireAt = nextOccurrence(alarm.hour, alarm.minute);

  const notificationId = await Notifications.scheduleNotificationAsync({
    identifier: `${ALARM_NOTIFICATION_TYPE}_${alarm.id}`,
    content: {
      title: alarm.label ? `⏰ ${alarm.label}` : 'WAKE UP!',
      body: alarm.song?.title
        ? `Your alarm song: ${alarm.song.title}`
        : 'Unstoppable YouTube Music alarm ringing',
      // No notification sound: the ringing screen streams the song instead.
      sound: null,
      priority: Notifications.AndroidNotificationPriority.MAX,
      vibrate: [0, 500, 250, 500, 250, 500],
      categoryIdentifier: ALARM_CATEGORY_ID,
      color: '#FF0033',
      data: {
        type: ALARM_NOTIFICATION_TYPE,
        alarmId: alarm.id,
        isAlarmTrigger: true,
        // Read by the native patch inside ExpoNotificationBuilder.
        fullScreenIntent: true,
        videoId: alarm.song?.video_id ?? null,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      channelId: ALARM_CHANNEL_ID,
    },
  });

  return notificationId;
};

/**
 * Re-arm every enabled alarm.
 * Call on app start: scheduled notifications do not survive a reboot and their
 * identifiers are stale after an app update.
 *
 * @returns {Promise<{alarms: Array, failed: number}>}
 */
export const rescheduleAllAlarms = async (alarms) => {
  const updated = [];
  let failed = 0;

  for (const alarm of alarms) {
    if (!alarm.enabled) {
      updated.push({ ...alarm, notificationId: null });
      continue;
    }
    try {
      const notificationId = await scheduleAlarmNotification(alarm);
      updated.push({ ...alarm, notificationId });
    } catch (e) {
      failed += 1;
      console.warn(`[notifications] Could not schedule ${alarm.id}`, e);
      updated.push({ ...alarm, notificationId: null });
    }
  }
  return { alarms: updated, failed };
};

/** Cancel everything that belongs to one alarm id. */
export const cancelAlarmNotification = async (alarmId) => {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter(
        (n) =>
          n.content?.data?.alarmId === alarmId ||
          (n.identifier || '').startsWith(`${ALARM_NOTIFICATION_TYPE}_${alarmId}`)
      )
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
};

/** "7:30 AM tomorrow" — used in the settings screen / debug rows. */
export const describeNextTrigger = async (alarm) => {
  try {
    const date = nextOccurrence(alarm.hour, alarm.minute);
    return date.toLocaleString(undefined, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    return '—';
  }
};
