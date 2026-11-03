import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import * as ApiService from '../services/ApiService';
import { colors, radius, spacing, typography } from '../theme';

/**
 * Optional: pin a specific song to an alarm instead of "surprise me".
 * Backed by GET /search on the alarm backend.
 */
export default function SongPickerSheet({ serverUrl, apiKey, currentSong, onSelect, onClose }) {
  const [query, setQuery] = useState(currentSong?.title || '');
  const [results, setResults] = useState([]);
  const [state, setState] = useState({ status: 'idle', message: '' });
  const requestId = useRef(0);

  const search = useCallback(async () => {
    const term = query.trim();
    if (term.length < 2) {
      setState({ status: 'error', message: 'Type at least 2 characters.' });
      return;
    }

    Keyboard.dismiss();
    requestId.current += 1;
    const thisRequest = requestId.current;
    setState({ status: 'loading', message: 'Searching YouTube Music…' });

    try {
      const found = await ApiService.searchSongs(serverUrl, term, { apiKey });
      if (requestId.current !== thisRequest) return; // a newer search won
      setResults(found);
      setState({
        status: found.length ? 'ok' : 'empty',
        message: found.length ? `${found.length} results` : 'No songs found.',
      });
    } catch (e) {
      if (requestId.current !== thisRequest) return;
      setState({ status: 'error', message: e.message || 'Search failed.' });
    }
  }, [apiKey, query, serverUrl]);

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Alarm song</Text>
        <Text style={styles.subtitle}>
          Search for a track, or leave it empty to get a random song from your
          Liked Songs every morning.
        </Text>

        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={search}
            placeholder="Song or artist"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            autoCorrect={false}
            returnKeyType="search"
          />
          <Pressable
            style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]}
            onPress={search}
            disabled={state.status === 'loading'}
          >
            {state.status === 'loading' ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <Text style={styles.searchButtonText}>Go</Text>
            )}
          </Pressable>
        </View>

        <Pressable
          style={({ pressed }) => [styles.randomRow, pressed && styles.pressed]}
          onPress={() => onSelect(null)}
        >
          <Text style={styles.randomEmoji}>🎲</Text>
          <View style={styles.flex}>
            <Text style={styles.randomTitle}>Surprise me</Text>
            <Text style={styles.randomHint}>Random track from Liked Songs / charts</Text>
          </View>
          {!currentSong ? <Text style={styles.selectedMark}>✓</Text> : null}
        </Pressable>

        {state.message && state.status !== 'ok' ? (
          <Text
            style={[
              styles.status,
              state.status === 'error' ? styles.statusError : styles.statusMuted,
            ]}
          >
            {state.message}
          </Text>
        ) : null}

        <FlatList
          data={results}
          keyExtractor={(item) => item.video_id}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          renderItem={({ item }) => {
            const selected = currentSong?.video_id === item.video_id;
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.resultRow,
                  selected && styles.resultSelected,
                  pressed && styles.pressed,
                ]}
                onPress={() => onSelect(item)}
              >
                <View style={styles.flex}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.resultArtist} numberOfLines={1}>
                    {item.artist}
                  </Text>
                </View>
                {selected ? <Text style={styles.selectedMark}>✓</Text> : null}
              </Pressable>
            );
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 55,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  sheet: {
    maxHeight: '82%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg + 8,
    borderTopRightRadius: radius.lg + 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  title: { ...typography.title, fontSize: 22, color: colors.text },
  subtitle: {
    ...typography.body,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  searchRow: { flexDirection: 'row', gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
  },
  searchButton: {
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  searchButtonText: { ...typography.body, color: colors.text, fontWeight: '700' },
  randomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    marginTop: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  randomEmoji: { fontSize: 20, marginRight: spacing.md },
  randomTitle: { ...typography.body, color: colors.text },
  randomHint: { ...typography.body, fontSize: 12, color: colors.textFaint },
  status: { ...typography.body, fontSize: 12, marginTop: spacing.md },
  statusError: { color: colors.warning },
  statusMuted: { color: colors.textFaint },
  list: { marginTop: spacing.md },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  resultSelected: { backgroundColor: colors.accentSoft, borderRadius: radius.sm },
  resultTitle: { ...typography.body, color: colors.text },
  resultArtist: { ...typography.body, fontSize: 12, color: colors.textFaint },
  selectedMark: { color: colors.accent, marginLeft: spacing.md, fontWeight: '700' },
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
});
