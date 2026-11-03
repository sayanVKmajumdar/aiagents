/**
 * withFullScreenAlarmNotification
 * -------------------------------
 * A local notification does NOT wake a sleeping phone the way a real alarm does.
 * To get clock-app behaviour (screen lights up instantly and the ringing screen
 * is shown over the keyguard) the notification needs a **full-screen intent**.
 *
 * expo-notifications has no JS API for that, and the native builder it uses is
 * `ExpoNotificationBuilder.build()` (node_modules/expo-notifications/android/
 * .../presentation/builders/ExpoNotificationBuilder.kt). So this plugin:
 *
 *   1. Patches that Kotlin file (idempotently) so notifications whose JS payload
 *      carries `data.fullScreenIntent = true` also get a full-screen intent,
 *      CATEGORY_ALARM and PUBLIC lockscreen visibility.
 *   2. Re-applies showWhenLocked / turnScreenOn to MainActivity defensively.
 *   3. Declares the alarm <queries> intents that Android 14+ checks before it
 *      grants USE_FULL_SCREEN_INTENT to non-clock apps.
 *
 * The patch is textual on purpose: it survives expo-notifications patch
 * releases, and if a future SDK moves the file it logs exactly what to fix and
 * the app still builds (only the instant-wake behaviour degrades to a normal
 * heads-up notification).
 */

const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'applyFullScreenAlarmIntent';
const BUILDER_RELATIVE_PATH = path.join(
  'expo-notifications',
  'android',
  'src',
  'main',
  'java',
  'expo',
  'modules',
  'notifications',
  'notifications',
  'presentation',
  'builders',
  'ExpoNotificationBuilder.kt'
);

const INJECTED_METHOD = `
  /**
   * Injected by plugins/withFullScreenAlarmNotification.js.
   * Escalates an alarm notification into a real wake-up call by attaching a
   * full-screen PendingIntent that launches MainActivity over the keyguard,
   * exactly like the system Clock app does.
   */
  private fun ${MARKER}(builder: NotificationCompat.Builder) {
    val data = notification.notificationRequest.content.body ?: return
    if (!data.optBoolean("fullScreenIntent", false)) return

    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    launchIntent.putExtra("isAlarmTrigger", true)
    launchIntent.putExtra("alarmId", data.optString("alarmId"))

    val pendingIntent = PendingIntent.getActivity(
      context,
      data.optString("alarmId").hashCode(),
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    builder.setFullScreenIntent(pendingIntent, true)
    builder.setCategory(Notification.CATEGORY_ALARM)
    builder.setVisibility(Notification.VISIBILITY_PUBLIC)
  }
`;

function patchNotificationBuilder(projectRoot, options = {}) {
  const file = path.join(projectRoot, 'node_modules', BUILDER_RELATIVE_PATH);

  if (!fs.existsSync(file)) {
    console.warn(
      '[withFullScreenAlarmNotification] Could not find expo-notifications native sources ' +
        `(${BUILDER_RELATIVE_PATH}). Full-screen alarm intents were skipped. ` +
        'Run `npx expo install expo-notifications` and rebuild.'
    );
    return false;
  }

  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(MARKER)) {
    return true; // already patched by an earlier prebuild
  }

  const missingImports = [];
  if (!/^import android\.content\.Intent$/m.test(source)) {
    missingImports.push('import android.content.Intent');
  }
  if (!/^import android\.app\.PendingIntent$/m.test(source)) {
    missingImports.push('import android.app.PendingIntent');
  }
  if (missingImports.length) {
    source = source.replace(
      /^import android\.app\.Notification$/m,
      ['import android.app.Notification', ...missingImports].join('\n')
    );
  }

  const anchor = '  private fun applySoundsAndVibrations(';
  const returnAnchor = '    return builder.build()';
  if (!source.includes(anchor) || !source.includes(returnAnchor)) {
    console.warn(
      '[withFullScreenAlarmNotification] ExpoNotificationBuilder.kt layout changed; patch ' +
        'aborted. Alarms still fire, but some ROMs may show only a heads-up notification ' +
        'instead of waking the screen. Please open an issue with your expo-notifications version.'
    );
    return false;
  }

  source = source.replace(anchor, `${INJECTED_METHOD}\n${anchor}`);
  source = source.replace(returnAnchor, `    ${MARKER}(builder)\n${returnAnchor}`);

  fs.writeFileSync(file, source, 'utf8');
  console.log('[withFullScreenAlarmNotification] Patched ExpoNotificationBuilder.kt');
  return true;
}

function withPatchedBuilder(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      patchNotificationBuilder(config.modRequest.projectRoot);
      return config;
    },
  ]);
}

function withManifest(config, options = {}) {
  return withAndroidManifest(config, (config) => {
    // config.modResults is the <root> wrapper: permissions and <queries> hang
    // off config.modResults.manifest, the application off that same element.
    const manifestElement = config.modResults.manifest;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);

    if (options.showWhenLocked !== false) {
      const activity = (application.activity || []).find((item) => {
        const name = item.$['android:name'] || '';
        return name === '.MainActivity' || /\.MainActivity$/.test(name);
      });
      if (activity) {
        activity.$['android:showWhenLocked'] = 'true';
        activity.$['android:turnScreenOn'] = 'true';
      }
    }

    manifestElement.queries = manifestElement.queries || [];
    const hasAlarmQuery = manifestElement.queries.some((query) =>
      (query.intent || []).some((intent) =>
        (intent.action || []).some(
          (action) => action.$['android:name'] === 'android.intent.action.SHOW_ALARMS'
        )
      )
    );
    if (!hasAlarmQuery) {
      manifestElement.queries.push({
        intent: [
          { action: [{ $: { 'android:name': 'android.intent.action.SHOW_ALARMS' } }] },
          { action: [{ $: { 'android:name': 'android.intent.action.SET_ALARM' } }] },
          { action: [{ $: { 'android:name': 'android.intent.action.DISMISS_ALARM' } }] },
        ],
      });
    }

    return config;
  });
}

module.exports = function withFullScreenAlarmNotification(config, options = {}) {
  config = withPatchedBuilder(config, options);
  config = withManifest(config, options);
  return config;
};

// Exported for unit tests.
module.exports.patchNotificationBuilder = patchNotificationBuilder;
