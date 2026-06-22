import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppErrorBoundary } from '../src/ui/ErrorBoundary';
import { ThemeProvider } from '../src/ui/components';
import { brandTheme } from '../src/ui/tokens';

// Root layout — wraps the whole app in crash safety + the design system.
// Change the accent below to the brand colour. Add screens as files in app/.
export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider theme={brandTheme('#3a5a78')}>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }} />
        </ThemeProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
