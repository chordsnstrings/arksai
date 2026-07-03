import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Header, Field, Button, Loading, useTheme, useToast } from '../../src/ui/components';
import { getItem, createItem, updateItem, deleteItem } from '../../src/lib/db';

// EXEMPLAR detail/edit screen — handles new + existing; clone per real entity.
export default function ItemDetail() {
  const t = useTheme();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [loaded, setLoaded] = useState(isNew);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) return;
    getItem(String(id)).then((it) => {
      if (it) { setTitle(it.title); setNotes(it.notes); }
      setLoaded(true);
    });
  }, [id, isNew]);

  async function save() {
    if (busy || !title.trim()) return;
    setBusy(true);
    try {
      if (isNew) await createItem(title, notes);
      else await updateItem(String(id), { title: title.trim(), notes });
      toast('Saved');
      router.back();
    } finally { setBusy(false); }
  }
  async function remove() {
    if (busy || isNew) return;
    setBusy(true);
    try { await deleteItem(String(id)); toast('Deleted'); router.back(); }
    finally { setBusy(false); }
  }

  if (!loaded) return <Screen><Loading /></Screen>;
  return (
    <Screen scroll>
      <Header title={isNew ? 'New item' : 'Edit item'} onBack={() => router.back()} />
      <View style={{ gap: t.space.lg }}>
        <Field label="Title" value={title} onChangeText={setTitle} />
        <Field label="Notes" value={notes} onChangeText={setNotes} />
        <Button title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={!title.trim()} loading={busy} />
        {!isNew ? <Button variant="ghost" title="Delete" onPress={remove} /> : null}
      </View>
    </Screen>
  );
}
