/**
 * withAndroidAlarmFlags
 * ---------------------
 * Runs at prebuild / EAS build time and edits the *generated* AndroidManifest so
 * a ringing alarm can take over a locked, sleeping phone.
 *
 * What it adds to MainActivity:
 *   android:showWhenLocked   -> the activity is drawn on top of the keyguard
 *   android:turnScreenOn     -> the activity wakes the display
 *   android:launchMode       -> singleTask, so a second notification reuses it
 *
 * Why the attribute cleanup: older tutorials pass
 * `android:showOnLockScreen` (a misspelling of the legacy iOS-era key). It is
 * not a real framework attribute and strict OEM manifest mergers fail the
 * install, so any leftover copies are removed here.
 */

const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const LEGACY_ATTRIBUTES = ['android:showOnLockScreen', 'android:showOnLocked'];

const ALARM_PERMISSIONS = [
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.WAKE_LOCK',
  'android.permission.DISABLE_KEYGUARD',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_EXACT_ALARM',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.VIBRATE',
  'android.permission.POST_NOTIFICATIONS',
];

function findMainActivity(androidManifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  const activities = application.activity || [];
  return (
    activities.find((activity) => {
      const name = activity.$['android:name'] || '';
      return name === '.MainActivity' || /\.MainActivity$/.test(name);
    }) || null
  );
}

/**
 * @param {object} androidManifest Parsed AndroidManifest.xml (config-plugins AST)
 * @param {{showWhenLocked?: boolean}} [options]
 */
function applyLockscreenFlags(androidManifest, options = {}) {
  const showWhenLocked = options.showWhenLocked !== false;
  const activity = findMainActivity(androidManifest);

  if (!activity) {
    console.warn(
      '[withAndroidAlarmFlags] MainActivity not found in AndroidManifest.xml — ' +
        'lockscreen flags were not applied. Did the android platform get prebuilt?'
    );
    return androidManifest;
  }

  if (showWhenLocked) {
    activity.$['android:showWhenLocked'] = 'true';
    activity.$['android:turnScreenOn'] = 'true';
  }
  activity.$['android:launchMode'] = activity.$['android:launchMode'] || 'singleTask';

  for (const legacy of LEGACY_ATTRIBUTES) {
    delete activity.$[legacy];
  }

  return androidManifest;
}

/**
 * Add the alarm permissions and drop permissions we do not want.
 *
 * NOTE: the modResults AST is the <root> wrapper; permissions live on
 * <root>.manifest, not on the root itself.
 *
 * The *install-time* normal permissions are declared explicitly (instead of
 * relying on implicit grants) so a reviewer / `pm list permissions` output
 * matches what the app actually does.
 */
function ensurePermissions(androidManifest, options = {}) {
  const manifestElement = androidManifest.manifest;
  manifestElement['uses-permission'] = manifestElement['uses-permission'] || [];

  const deny = new Set(options.removePermissions || []);
  const kept = manifestElement['uses-permission'].filter(
    (item) => !deny.has(item.$['android:name'])
  );

  const names = new Set(kept.map((item) => item.$['android:name']));
  for (const permission of ALARM_PERMISSIONS) {
    if (names.has(permission) || deny.has(permission)) continue;
    kept.push({ $: { 'android:name': permission } });
    names.add(permission);
  }

  manifestElement['uses-permission'] = kept;
  return androidManifest;
}

module.exports = function withAndroidAlarmFlags(config, options = {}) {
  return withAndroidManifest(config, (config) => {
    config.modResults = applyLockscreenFlags(config.modResults, options);
    config.modResults = ensurePermissions(config.modResults, options);
    return config;
  });
};

// Exported for unit tests.
module.exports.applyLockscreenFlags = applyLockscreenFlags;
module.exports.ensurePermissions = ensurePermissions;
