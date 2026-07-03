import { useCallback, useState } from 'react';
import { View, FlatList } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Screen, AppText, ListRow, Divider, EmptyState, Loading, FAB, SearchBar, useTheme } from '../../src/ui/components';
import { listItems, type Item } from '../../src/lib/db';

// EXEMPLAR list screen — clone + rename per real entity (with its db functions + detail screen).
export default function Items() {
  const t = useTheme();
  const [rows, setRows] = useState<Item[] | null>(null);
  const [q, setQ] = useState('');

  useFocusEffect(useCallback(() => { listItems().then(setRows).catch(() => setRows([])); }, []));

  if (rows === null) return <Screen><Loading /></Screen>;
  const visible = rows.filter((r) => !q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Screen>
      <View style={{ gap: t.space.md, paddingTop: t.space.md, flex: 1 }}>
        <AppText variant="title">Items</AppText>
        <SearchBar value={q} onChangeText={setQ} />
        {visible.length === 0 ? (
          <EmptyState title={q ? 'No matches' : 'Nothing yet'} subtitle={q ? 'Try a different search.' : 'Tap + to add the first one.'} />
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(x) => x.id}
            ItemSeparatorComponent={Divider}
            renderItem={({ item }) => (
              <ListRow
                title={item.title}
                subtitle={item.notes || new Date(item.createdAt).toLocaleDateString()}
                chevron
                onPress={() => router.push(`/item/${item.id}`)}
              />
            )}
          />
        )}
      </View>
      <FAB onPress={() => router.push('/item/new')} label="Add item" />
    </Screen>
  );
}
