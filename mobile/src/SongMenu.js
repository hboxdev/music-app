import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from './theme';
import { thumbUrl } from './youtube';

// Bottom sheet with actions for one song
export default function SongMenu({
  song,
  playlists,
  currentPlaylistId,
  onClose,
  onPlayNext,
  onEdit,
  onOpenYouTube,
  onAddToPlaylist,
  onNewPlaylist,
  onRemoveFromPlaylist,
  onDelete,
}) {
  const insets = useSafeAreaInsets();
  const [picking, setPicking] = useState(false);

  useEffect(() => setPicking(false), [song]);

  if (!song) return null;

  const act = (fn) => () => {
    onClose();
    fn(song);
  };

  const Item = ({ icon, label, onPress, danger }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.text} />
      <Text style={[styles.itemText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );

  const others = playlists.filter((p) => p.id !== currentPlaylistId);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.head}>
          <Image source={{ uri: thumbUrl(song.id) }} style={styles.thumb} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={2}>{song.title}</Text>
            <Text style={styles.artist} numberOfLines={1}>{song.artist || 'Unknown artist'}</Text>
          </View>
        </View>

        {picking ? (
          <ScrollView style={{ maxHeight: 360 }}>
            <Item icon="arrow-back" label="Back" onPress={() => setPicking(false)} />
            <Item icon="add-circle-outline" label="New playlist…" onPress={act(onNewPlaylist)} />
            {others.map((p) => (
              <Item
                key={p.id}
                icon="musical-notes-outline"
                label={p.name}
                onPress={() => {
                  onClose();
                  onAddToPlaylist(song, p.id);
                }}
              />
            ))}
          </ScrollView>
        ) : (
          <View>
            <Item icon="play-forward-outline" label="Play next" onPress={act(onPlayNext)} />
            <Item icon="add-outline" label="Add to playlist" onPress={() => setPicking(true)} />
            {currentPlaylistId ? (
              <Item icon="remove-circle-outline" label="Remove from this playlist" onPress={act(onRemoveFromPlaylist)} />
            ) : null}
            <Item icon="create-outline" label="Edit title / artist" onPress={act(onEdit)} />
            <Item icon="logo-youtube" label="Open in YouTube" onPress={act(onOpenYouTube)} />
            <Item icon="trash-outline" label="Delete from library" danger onPress={act(onDelete)} />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 16,
    paddingHorizontal: 8,
  },
  head: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    marginBottom: 6,
  },
  thumb: { width: 80, height: 45, borderRadius: 6, backgroundColor: colors.line },
  title: { color: colors.text, fontWeight: '600', fontSize: 15 },
  artist: { color: colors.muted, fontSize: 13, marginTop: 2 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  pressed: { backgroundColor: colors.raised },
  itemText: { color: colors.text, fontSize: 15 },
});
