import { View } from 'react-native';
import Constants from 'expo-constants';
import { Screen, AppText, SectionHeader, SettingRow, Divider, Card, useTheme } from '../../src/ui/components';

// Settings — complete as shipped; extend with the app's real preferences.
export default function Settings() {
  const t = useTheme();
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const appName = Constants.expoConfig?.name ?? 'App';
  return (
    <Screen scroll>
      <View style={{ paddingTop: t.space.md }}>
        <AppText variant="title">Settings</AppText>
      </View>
      <SectionHeader>About</SectionHeader>
      <Card style={{ paddingVertical: 0 }}>
        <SettingRow label="App" value={appName} />
        <Divider />
        <SettingRow label="Version" value={version} />
      </Card>
    </Screen>
  );
}
