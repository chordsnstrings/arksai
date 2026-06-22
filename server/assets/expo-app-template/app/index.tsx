import { View } from 'react-native';
import { Screen, AppText, Button, Card } from '../src/ui/components';
import { useTheme } from '../src/ui/components';

// Sample home screen — composed entirely from the UI kit (never raw default RN).
// Replace this with the app's real first screen; keep using kit components so the
// look stays minimal, modern and typography-first. Every list/data view should ship
// loading + empty + error states (see EmptyState / Loading in the kit).
export default function Home() {
  const t = useTheme();
  return (
    <Screen scroll>
      <View style={{ gap: t.space.lg, paddingTop: t.space.xl }}>
        <View style={{ gap: t.space.xs }}>
          <AppText variant="label" muted>
            WELCOME
          </AppText>
          <AppText variant="display">Your app starts here</AppText>
          <AppText variant="body" muted>
            Built on the ArksAI mobile kit — safe-area aware, light + dark, crash-safe.
          </AppText>
        </View>

        <Card>
          <View style={{ gap: t.space.sm }}>
            <AppText variant="heading">Next steps</AppText>
            <AppText variant="body" muted>
              Add screens as files in app/. Compose them from the kit&apos;s Screen,
              AppText, Button, Card, Field, EmptyState and Loading.
            </AppText>
          </View>
        </Card>

        <Button title="Get started" onPress={() => {}} />
      </View>
    </Screen>
  );
}
