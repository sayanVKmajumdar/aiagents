/**
 * Unit tests for the two config plugins.
 *
 *   cd mobile && npx jest --config jest.config.js
 *
 * These run without any Android toolchain: they feed a realistic prebuild
 * manifest through the plugins and assert the native flags end up on the right
 * XML nodes (a mistake here silently means "alarm never wakes the phone").
 */

const { AndroidConfig, XML } = require('@expo/config-plugins');

const withAndroidAlarmFlags = require('../plugins/withAndroidAlarmFlags');
const withFullScreenAlarm = require('../plugins/withFullScreenAlarmNotification');

const PREBUILD_MANIFEST = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.INTERNET"/>
  <uses-permission android:name="android.permission.RECORD_AUDIO"/>
  <application android:name=".MainApplication" android:label="@string/app_name">
    <activity android:name=".MainActivity" android:launchMode="singleTask">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
      </intent-filter>
    </activity>
  </application>
</manifest>`;

const parseManifest = () => XML.parseXMLAsync(PREBUILD_MANIFEST).then((r) => r);

/** Run a `withAndroidManifest` mod body directly, avoiding a real prebuild. */
const runMod = async (plugin, options) => {
  const config = {
    name: 'test',
    slug: 'test',
    android: { package: 'com.ytalarm.app' },
  };
  const modded = plugin(config, options);
  const mod = modded.mods.android.manifest;
  const modResults = await parseManifest();
  mod({ ...modded, modResults });
  return modResults;
};

const permissionsOf = (modResults) =>
  (modResults.manifest['uses-permission'] || []).map((p) => p.$['android:name']);

const mainActivityOf = (modResults) =>
  AndroidConfig.Manifest.getMainApplicationOrThrow(modResults).activity.find(
    (a) => a.$['android:name'] === '.MainActivity'
  );

describe('withAndroidAlarmFlags', () => {
  it('sets the lockscreen takeover flags on MainActivity', async () => {
    const results = await runMod(withAndroidAlarmFlags);
    const activity = mainActivityOf(results);
    expect(activity.$['android:showWhenLocked']).toBe('true');
    expect(activity.$['android:turnScreenOn']).toBe('true');
    expect(activity.$['android:launchMode']).toBe('singleTask');
  });

  it('adds alarm permissions inside <manifest>, never at the root', async () => {
    const results = await runMod(withAndroidAlarmFlags);
    const permissions = permissionsOf(results);

    expect(permissions).toEqual(
      expect.arrayContaining([
        'android.permission.USE_FULL_SCREEN_INTENT',
        'android.permission.WAKE_LOCK',
        'android.permission.SCHEDULE_EXACT_ALARM',
        'android.permission.DISABLE_KEYGUARD',
      ])
    );
    // Root-level keys other than `manifest` would serialise outside <manifest>.
    expect(Object.keys(results)).toEqual(['manifest']);
  });

  it('removes permissions listed in removePermissions', async () => {
    const results = await runMod(withAndroidAlarmFlags, {
      removePermissions: ['android.permission.RECORD_AUDIO'],
    });
    expect(permissionsOf(results)).not.toContain('android.permission.RECORD_AUDIO');
  });

  it('strips the fake legacy showOnLockScreen attribute', () => {
    const manifest = {
      manifest: {
        $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
        application: [
          {
            $: { 'android:name': '.MainApplication' },
            activity: [
              {
                $: {
                  'android:name': '.MainActivity',
                  'android:showOnLockScreen': 'true',
                  'android:showOnLocked': 'true',
                },
              },
            ],
          },
        ],
      },
    };

    const result = withAndroidAlarmFlags.applyLockscreenFlags(manifest);
    const activity = result.manifest.application[0].activity[0];
    expect(activity.$['android:showOnLockScreen']).toBeUndefined();
    expect(activity.$['android:showOnLocked']).toBeUndefined();
    expect(activity.$['android:showWhenLocked']).toBe('true');
  });

  it('does not throw when there is no MainActivity', () => {
    const manifest = {
      manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' } }] },
    };
    expect(() => withAndroidAlarmFlags.applyLockscreenFlags(manifest)).not.toThrow();
  });
});

describe('withFullScreenAlarmNotification', () => {
  it('declares the alarm <queries> inside <manifest>', async () => {
    const results = await runMod(withFullScreenAlarm);
    const queries = results.manifest.queries;
    expect(queries).toBeDefined();

    const actions = queries.flatMap((q) =>
      (q.intent || []).flatMap((i) => (i.action || []).map((a) => a.$['android:name']))
    );
    expect(actions).toContain('android.intent.action.SHOW_ALARMS');
    expect(Object.keys(results)).toEqual(['manifest']);
  });

  it('patches the expo-notifications builder exactly once', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const target = path.join(
      'node_modules',
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
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alarm-plugin-'));
    const file = path.join(tmpRoot, target);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        'package expo.modules.notifications.notifications.presentation.builders',
        'import android.app.Notification',
        'class ExpoNotificationBuilder {',
        '  private fun applySoundsAndVibrations() {}',
        '  override suspend fun build(): Notification {',
        '    return builder.build()',
        '  }',
        '}',
      ].join('\n')
    );

    expect(withFullScreenAlarm.patchNotificationBuilder(tmpRoot)).toBe(true);
    const patched = fs.readFileSync(file, 'utf8');
    expect(patched).toContain('applyFullScreenAlarmIntent');
    expect(patched).toContain('import android.app.PendingIntent');
    expect(patched).toContain('import android.content.Intent');
    // Called right before the notification is built.
    expect(patched).toMatch(/applyFullScreenAlarmIntent\(builder\)\s*\n\s*return builder\.build\(\)/);

    // Second run is a no-op (idempotent).
    const before = fs.readFileSync(file, 'utf8');
    withFullScreenAlarm.patchNotificationBuilder(tmpRoot);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);

    // Missing library -> warning, no crash.
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alarm-plugin-empty-'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(withFullScreenAlarm.patchNotificationBuilder(emptyRoot)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
