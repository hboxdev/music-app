import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from './theme';
import { thumbUrl } from './youtube';

function SongRow({ song, number, playing, onPress, onMore }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, (pressed || playing) && styles.rowActive]}
    >
      <Text style={[styles.num, playing && styles.accent]}>
        {playing ? '♪' : number}
      </Text>
      <Image source={{ uri: thumbUrl(song.id) }} style={styles.thumb} />
      <View style={styles.info}>
        <Text style={[styles.title, playing && styles.accent]} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {song.artist || 'Unknown artist'}
        </Text>
      </View>
      <Pressable onPress={onMore} hitSlop={12} style={styles.more}>
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
  info: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 15, fontWeight: '500' },
  artist: { color: colors.muted, fontSize: 13, marginTop: 2 },
  accent: { color: colors.accent },
  more: { padding: 4 },
});
