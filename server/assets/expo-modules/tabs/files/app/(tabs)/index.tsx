import { View } from 'react-native';
import { Screen, AppText, Card, useTheme } from '../../src/ui/components';

// The home tab — replace with the app's REAL first surface (composed from the kit).
export default function Home() {
  const t = useTheme();
  return (
    <Screen scroll>
      <View style={{ gap: t.space.xs, paddingTop: t.space.md }}>
        <AppText variant="label" muted>HOME</AppText>
        <AppText variant="display">Build the real home here</AppText>
      </View>
      <Card>
        <AppText variant="heading">This is the scaffolded home tab</AppText>
        <AppText muted>Replace it with the app&apos;s real content before delivering.</AppText>
      </Card>
    </Screen>
  );
}
