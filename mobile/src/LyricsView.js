import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { colors } from './theme';
import { activeLine, getLyrics } from './lyrics';

// Saved lyrics stay on the phone, so they also show offline
const store = {
  get: async (key) => {
    try {
      return JSON.parse(await AsyncStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set: (key, value) => AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {}),
};

// Lyrics for the playing song. Synced lyrics follow the song and
// tapping a line jumps there.
export default function Lyrics({ song, time, duration, onSeek }) {
  const [state, setState] = useState({ status: 'loading', lyrics: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  const scroller = useRef(null);
  const lineY = useRef([]);
  const boxHeight = useRef(0);
  const userScrolledAt = useRef(0);
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    let alive = true;
    lineY.current = [];
    setState({ status: 'loading', lyrics: null, error: '' });
    getLyrics(song, durationRef.current, store)
      .then((lyrics) => alive && setState({ status: lyrics ? 'ready' : 'missing', lyrics, error: '' }))
      .catch((e) => alive && setState({ status: 'error', lyrics: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [song.id, attempt]);

  const lines = state.lyrics && state.lyrics.synced;
  const active = lines ? activeLine(lines, time) : -1;

  // Keeps the current line in the middle, unless the user just scrolled
  useEffect(() => {
    const y = lineY.current[active];
    if (y === undefined || !scroller.current || Date.now() - userScrolledAt.current < 3000) return;
    scroller.current.scrollTo({ y: Math.max(0, y - boxHeight.current / 2 + 20), animated: true });
  }, [active]);

  let body;
  if (state.status === 'loading') {
    body = <ActivityIndicator color="#fff" style={styles.note} />;
  } else if (state.status === 'error') {
    body = (
      <View style={styles.note}>
        <Text style={styles.noteText}>{state.error}</Text>
        <Pressable onPress={() => setAttempt((n) => n + 1)} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else if (state.status === 'missing') {
    body = (
      <View style={styles.note}>
        <Ionicons name="mic-off-outline" size={30} color="rgba(255,255,255,0.7)" />
        <Text style={styles.noteText}>No lyrics found for this song.</Text>
      </View>
    );
  } else if (state.lyrics.instrumental) {
    body = <Text style={[styles.noteText, styles.note]}>♪ Instrumental ♪</Text>;
  } else {
    body = (
      <ScrollView
        ref={scroller}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onLayout={(e) => (boxHeight.current = e.nativeEvent.layout.height)}
        onScrollBeginDrag={() => (userScrolledAt.current = Date.now())}
      >
        {lines ? (
          lines.map((l, i) => (
            <Text
              key={i}
              onLayout={(e) => (lineY.current[i] = e.nativeEvent.layout.y)}
              onPress={() => {
                userScrolledAt.current = 0;
                onSeek(l.t);
              }}
              style={[styles.line, i < active && styles.past, i === active && styles.on]}
            >
              {l.text || '♪'}
            </Text>
          ))
        ) : (
          <Text style={styles.plain}>{state.lyrics.plain}</Text>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.box}>
      {body}
      {state.status === 'ready' ? (
        <Text style={styles.credit} onPress={() => Linking.openURL('https://lrclib.net')}>
          Lyrics from LRCLIB{!lines && !state.lyrics.instrumental ? ' · not synced to the song' : ''}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, marginTop: 16, borderRadius: 12, backgroundColor: colors.raised, paddingHorizontal: 16, paddingBottom: 8, overflow: 'hidden' },
  scroll: { flex: 1 },
  scrollContent: { paddingVertical: 24 },
  line: { color: 'rgba(255,255,255,0.35)', fontSize: 20, fontWeight: '700', lineHeight: 27, paddingVertical: 5 },
  past: { color: 'rgba(255,255,255,0.6)' },
  on: { color: '#fff' },
  plain: { color: 'rgba(255,255,255,0.85)', fontSize: 16, fontWeight: '600', lineHeight: 26 },
  note: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center', textAlignVertical: 'center' },
  noteText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, textAlign: 'center' },
  retry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.text },
  retryText: { color: colors.bg, fontWeight: '700' },
  credit: { color: 'rgba(255,255,255,0.5)', fontSize: 11, paddingTop: 6 },
});
