import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Screen, Header, AppText, Button, Card, EmptyState, Sheet, useTheme } from '../src/ui/components';

// QR / barcode scanner — complete flow: permission ask (with a real explanation),
// live camera, and a result sheet with actions. Handle the scanned value in onResult.
export default function Scan() {
  const t = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  const onScanned = (r: BarcodeScanningResult) => {
    if (paused || !r?.data) return;
    setPaused(true);
    setResult(String(r.data));
  };

  if (!permission) return <Screen><EmptyState title="Preparing camera…" /></Screen>;
  if (!permission.granted) {
    return (
      <Screen>
        <Header title="Scan" onBack={() => router.back()} />
        <EmptyState
          title="Camera access needed"
          subtitle="The camera is only used to read codes in front of you — nothing is recorded or stored."
          action={<Button title="Allow camera" onPress={requestPermission} />}
        />
      </Screen>
    );
  }

  return (
    <Screen style={{ padding: 0 }}>
      <View style={{ position: 'absolute', top: t.space.xl, left: t.space.lg, right: t.space.lg, zIndex: 2 }}>
        <Header title="Scan a code" onBack={() => router.back()} />
      </View>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={onScanned}
      />
      <Sheet open={!!result} onClose={() => { setResult(null); setPaused(false); }} title="Scanned">
        <Card><AppText>{result ?? ''}</AppText></Card>
        <Button title="Scan another" onPress={() => { setResult(null); setPaused(false); }} />
        <Button variant="ghost" title="Done" onPress={() => router.back()} />
      </Sheet>
    </Screen>
  );
}
