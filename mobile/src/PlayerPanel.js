import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import YouTubeEngine from './YouTubeEngine';
import LyricsView from './LyricsView';
import { colors, fmtTime } from './theme';
import { SOURCE_LABELS, artworkOf, isYouTube, sourceOf } from './sources';

// Mini player bar that expands to a full-screen player.
// The video view keeps the same place in the tree in both modes,
// so expanding or collapsing never reloads the song.
const PlayerPanel = forwardRef(function PlayerPanel(
  {
    song,
    isPlaying,
    expanded,
    onExpand,
    onCollapse,
    shuffle,
    repeat,
    onToggleShuffle,
    onCycleRepeat,
    onPlayPause,
    onNext,
    onPrev,
    onReady,
    onStateChange,
    onError,
    audioTime, // { t, d } while a non-YouTube song plays, otherwise null
    onSeekAudio,
  },
  ref
) {
  const insets = useSafeAreaInsets();
  const engine = useRef(null);
  const timeRef = useRef({ t: 0, d: 0 });
  const [time, setTime] = useState({ t: 0, d: 0 });
  const [seekValue, setSeekValue] = useState(null);
  const [showLyrics, setShowLyrics] = useState(false);

  const updateTime = (v) => {
    timeRef.current = v;
    setTime(v);
  };

  useImperativeHandle(ref, () => ({
    load: (id) => {
      updateTime({ t: 0, d: 0 });
      engine.current && engine.current.load(id);
    },
    play: () => engine.current && engine.current.play(),
    pause: () => engine.current && engine.current.pause(),
    seekTo: (s) => engine.current && engine.current.seekTo(s),
    getTime: () => timeRef.current.t,
  }));

  const audioSong = !!song && !isYouTube(song);
  // Live radio has no length and can't be seeked
  const live = !!song && !!song.live;
  const art = audioSong ? artworkOf(song) : null;
  const t = audioSong && audioTime ? audioTime : time;
  const progress = t.d ? Math.min(1, t.t / t.d) : 0;
  const shownTime = seekValue ?? t.t;
  const lyricsOn = showLyrics && !!song && !live;

  const seek = (v) => {
    if (audioSong) onSeekAudio(v);
    else {
      engine.current && engine.current.seekTo(v);
      updateTime({ t: v, d: time.d });
    }
  };

  const subtitle = song
    ? `${song.artist || 'Unknown artist'}${audioSong ? ` · ${SOURCE_LABELS[sourceOf(song)]}` : ''}`
    : 'Pick a song to start';

  const cover = audioSong ? (
    <View style={styles.cover} pointerEvents="none">
      {art ? (
        <Image source={{ uri: art }} style={styles.coverImg} resizeMode="cover" />
      ) : (
        <Ionicons name="musical-notes" size={expanded ? 64 : 24} color="#fff" />
      )}
    </View>
  ) : null;

  return (
    <View
      style={
        expanded
          ? [styles.full, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]
          : [styles.mini, { paddingBottom: insets.bottom + 8 }]
      }
    >
      {expanded ? (
        <View style={styles.fullHeader}>
          <Pressable onPress={onCollapse} hitSlop={12}>
            <Ionicons name="chevron-down" size={28} color={colors.text} />
          </Pressable>
          <Text style={styles.fullHeaderText}>{lyricsOn ? 'Lyrics' : 'Now playing'}</Text>
          <Pressable onPress={() => setShowLyrics(!showLyrics)} hitSlop={12} disabled={!song || live} style={(!song || live) && { opacity: 0.3 }}>
            <Ionicons name={lyricsOn ? 'mic' : 'mic-outline'} size={24} color={lyricsOn ? colors.accent : colors.text} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.miniTrack}>
          <View style={[styles.miniFill, { width: `${progress * 100}%` }]} />
        </View>
      )}

      <View style={expanded ? styles.bodyFull : styles.bodyMini}>
        <View style={expanded ? styles.videoFull : styles.videoMini}>
          <YouTubeEngine
            ref={engine}
            onReady={onReady}
            onStateChange={onStateChange}
            onError={onError}
            onTime={(v) => seekValue === null && updateTime(v)}
          />
          {cover}
        </View>

        {expanded ? (
          <View style={[styles.fullControls, lyricsOn && styles.withLyrics]}>
            <Text style={[styles.fullTitle, lyricsOn && styles.smallTitle]} numberOfLines={lyricsOn ? 1 : 2}>
              {song ? song.title : 'Nothing playing'}
            </Text>
            <Text style={styles.fullArtist} numberOfLines={1}>
              {subtitle}
            </Text>
            {lyricsOn ? <LyricsView song={song} time={t.t} duration={t.d} onSeek={seek} /> : null}

            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={live ? 1 : t.d || 1}
              value={live ? 0 : shownTime}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.line}
              thumbTintColor={colors.accent}
              onValueChange={setSeekValue}
              onSlidingComplete={(v) => {
                seek(v);
                setSeekValue(null);
              }}
              disabled={!song || live}
            />
            <View style={styles.times}>
              <Text style={styles.time}>{fmtTime(shownTime)}</Text>
              <Text style={[styles.time, live && styles.live]}>{live ? 'LIVE' : fmtTime(t.d)}</Text>
            </View>

            <View style={styles.buttons}>
              <Pressable onPress={onToggleShuffle} hitSlop={10}>
                <Ionicons name="shuffle" size={26} color={shuffle ? colors.accent : colors.muted} />
              </Pressable>
              <Pressable onPress={onPrev} hitSlop={10}>
                <Ionicons name="play-skip-back" size={30} color={colors.text} />
              </Pressable>
              <Pressable onPress={onPlayPause} style={styles.bigPlay}>
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={34} color={colors.bg} style={!isPlaying && { marginLeft: 4 }} />
              </Pressable>
              <Pressable onPress={onNext} hitSlop={10}>
                <Ionicons name="play-skip-forward" size={30} color={colors.text} />
              </Pressable>
              <Pressable onPress={onCycleRepeat} hitSlop={10} style={styles.repeat}>
                <Ionicons name="repeat" size={26} color={repeat !== 'off' ? colors.accent : colors.muted} />
                {repeat === 'one' ? <Text style={styles.repeatOne}>1</Text> : null}
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <Pressable style={styles.miniText} onPress={onExpand}>
              <Text style={styles.miniTitle} numberOfLines={1}>
                {song ? song.title : 'Nothing playing'}
              </Text>
              <Text style={styles.miniArtist} numberOfLines={1}>
                {subtitle}
              </Text>
            </Pressable>
            <Pressable onPress={onPlayPause} hitSlop={8} style={styles.miniBtn}>
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={28} color={colors.text} />
            </Pressable>
            <Pressable onPress={onNext} hitSlop={8} style={styles.miniBtn}>
              <Ionicons name="play-skip-forward" size={24} color={colors.text} />
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
});

export default PlayerPanel;

const styles = StyleSheet.create({
  mini: {
    backgroundColor: colors.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  miniTrack: { height: 2, backgroundColor: colors.line },
  miniFill: { height: 2, backgroundColor: colors.accent },
  bodyMini: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 12,
  },
  videoMini: { width: 112, height: 63, borderRadius: 8, overflow: 'hidden', backgroundColor: '#000' },
  cover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverImg: { width: '100%', height: '100%' },
  miniText: { flex: 1, minWidth: 0 },
  miniTitle: { color: colors.text, fontWeight: '600', fontSize: 14 },
  miniArtist: { color: colors.muted, fontSize: 12, marginTop: 2 },
  miniBtn: { padding: 4 },

  full: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    zIndex: 20,
    elevation: 20,
  },
  fullHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  fullHeaderText: { color: colors.muted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  bodyFull: { flex: 1, paddingHorizontal: 20 },
  videoFull: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  fullControls: { flex: 1, justifyContent: 'center' },
  withLyrics: { justifyContent: 'flex-start', paddingTop: 16 },
  smallTitle: { fontSize: 18 },
  fullTitle: { color: colors.text, fontSize: 22, fontWeight: '700' },
  fullArtist: { color: colors.muted, fontSize: 16, marginTop: 6 },
  slider: { width: '100%', height: 40, marginTop: 16 },
  times: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  time: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  live: { color: '#f87171', fontWeight: '800', letterSpacing: 1 },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    paddingHorizontal: 8,
  },
  bigPlay: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repeat: { alignItems: 'center', justifyContent: 'center' },
  repeatOne: { position: 'absolute', color: colors.accent, fontSize: 9, fontWeight: '800' },
});
