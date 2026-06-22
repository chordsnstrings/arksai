/**
 * ArksAI Mobile UI Kit — app-level Error Boundary (crash safety).
 *
 * Wrap the whole app in this so a runtime error shows a calm recovery screen instead of a
 * white-screen crash / native red box. Part of the "runs smoothly, doesn't suddenly crash"
 * guarantee: every generated app mounts <AppErrorBoundary> at the root.
 *
 *   import { AppErrorBoundary } from '@/ui/ErrorBoundary';
 *   export default function App(){ return (<AppErrorBoundary><Root/></AppErrorBoundary>); }
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lightTheme } from './tokens';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error) {
    // Hook for crash reporting later; never rethrow (that's the crash we're preventing).
    console.warn('[app] recovered from a render error:', error?.message);
  }
  reset = () => this.setState({ error: null });
  render() {
    const t = lightTheme;
    if (!this.state.error) return this.props.children;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.surface }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space.xl, gap: t.space.md }}>
          <Text style={[t.type.title, { color: t.colors.ink }]}>Something went wrong</Text>
          <Text style={[t.type.body, { color: t.colors.inkMuted, textAlign: 'center' }]}>
            The screen hit an unexpected error. You can try again.
          </Text>
          <Pressable
            onPress={this.reset}
            style={({ pressed }) => ({
              marginTop: t.space.sm,
              backgroundColor: t.colors.accent,
              paddingVertical: t.space.md + 2,
              paddingHorizontal: t.space.xl,
              borderRadius: t.radius.pill,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={[t.type.label, { color: t.colors.accentInk }]}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }
}
