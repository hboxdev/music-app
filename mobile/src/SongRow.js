import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from './theme';
import { SOURCE_LABELS, artworkOf, sourceOf } from './sources';

const BADGE_COLORS = { audius: '#8b5cf6', jamendo: '#0ea5e9', url: colors.muted };

// onAdd: when given, shows a + button (✓ once the song is in the library)
function SongRow({ song, number, playing, onPress, onMore, onAdd, inLibrary }) {
  const art = artworkOf(song);
  const src = sourceOf(song);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, (pressed || playing) && styles.rowActive]}
    >
      <Text style={[styles.num, playing && styles.accent]}>
        {playing ? '♪' : number}
      </Text>
      {art ? (
        <Image source={{ uri: art }} style={[styles.thumb, src !== 'youtube' && styles.square]} />
      ) : (
        <View style={[styles.thumb, styles.square, styles.blank]}>
          <Ionicons name="musical-note" size={16} color={colors.muted} />
        </View>
      )}
      <View style={styles.info}>
        <Text style={[styles.title, playing && styles.accent]} numberOfLines={1}>
          {song.title}
        </Text>
        <View style={styles.meta}>
          {src !== 'youtube' ? (
            <Text style={[styles.badge, { color: BADGE_COLORS[src] }]}>{SOURCE_LABELS[src]}</Text>
          ) : null}
          <Text style={styles.artist} numberOfLines={1}>
            {song.artist || 'Unknown artist'}
          </Text>
        </View>
      </View>
      {onAdd ? (
        <Pressable onPress={inLibrary ? undefined : onAdd} hitSlop={10} style={styles.btn}>
          <Ionicons
            name={inLibrary ? 'checkmark-circle' : 'add-circle-outline'}
            size={22}
            color={inLibrary ? colors.muted : colors.accent}
          />
        </Pressable>
      ) : null}
      <Pressable onPress={onMore} hitSlop={12} style={styles.btn}>
        <Ionicons name="ellipsis-vertical" size={18} color={colors.muted} />
      </Pressable>
    </Pressable>
  );
}

export default memo(SongRow);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    gap: 12,
  },
  rowActive: { backgroundColor: colors.raised },
  num: { width: 24, textAlign: 'right', color: colors.muted, fontVariant: ['tabular-nums'] },
  thumb: { width: 64, height: 36, borderRadius: 6, backgroundColor: colors.line },
  square: { width: 40, height: 40, marginHorizontal: 12 },
  blank: { alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 15, fontWeight: '500' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  badge: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  artist: { color: colors.muted, fontSize: 13, flexShrink: 1 },
  accent: { color: colors.accent },
  btn: { padding: 4 },
});
