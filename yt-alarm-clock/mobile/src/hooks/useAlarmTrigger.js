import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drives the ringing screen from a notification response — either the user
 * tapping the full-screen alarm notification, or the app being cold-started by
 * it (getLastNotificationResponseAsync).
 *
 * @param {{alarms: Array, onDismissed?: Function}} options
 * @returns {{activeAlarm: object|null, dismiss: Function}}
 */
export default function useAlarmTrigger({ alarms, onDismissed }) {
  const [activeAlarm, setActiveAlarm] = useState(null);
  const alarmsRef = useRef(alarms);

  useEffect(() => {
    alarmsRef.current = alarms;
  }, [alarms]);

  useEffect(() => {
    let mounted = true;

    const resolveAlarm = (notification) => {
      const data = notification?.request?.content?.data || {};
      if (!data.isAlarmTrigger) return null;

      const known = alarmsRef.current.find((alarm) => alarm.id === data.alarmId);
      if (known) return known;

      // The alarm may have been deleted/re-created while the notification was
      // pending; fall back to a synthetic object so the screen still works.
      const now = new Date();
      return {
        id: data.alarmId || 'unknown',
        hour: now.getHours(),
        minute: now.getMinutes(),
        label: 'Alarm',
        song: data.videoId ? { video_id: data.videoId, title: 'Your alarm song' } : null,
        enabled: true,
      };
    };

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const alarm = resolveAlarm(response.notification);
      if (alarm) setActiveAlarm(alarm);
    });

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!mounted || !response) return;
        const alarm = resolveAlarm(response.notification);
        if (alarm) setActiveAlarm(alarm);
      })
      .catch(() => {
        /* ignore — nothing was tapped */
      });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const dismiss = useCallback(() => {
    setActiveAlarm(null);
    Notifications.clearLastNotificationResponseAsync?.().catch(() => {});
    onDismissed?.();
  }, [onDismissed]);

  return { activeAlarm, dismiss };
}
