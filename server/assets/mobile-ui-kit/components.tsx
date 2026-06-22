/**
 * ArksAI Mobile UI Kit — core components (React Native / Expo).
 *
 * Minimal, modern, composable. Generated apps build screens from these — never raw
 * default RN elements. All read from the theme (./tokens). Every interactive element has
 * pressed/disabled states; lists have empty/loading states. Respect the safe area.
 *
 * Usage in a generated app:
 *   import { ThemeProvider, Screen, AppText, Button, Card, Field, EmptyState } from '@/ui';
 */
import React, { createContext, useContext } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView, ActivityIndicator,
  StyleSheet, type ViewStyle, type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lightTheme, type Theme } from './tokens';

const ThemeCtx = createContext<Theme>(lightTheme);
export const ThemeProvider = ({ theme = lightTheme, children }: { theme?: Theme; children: React.ReactNode }) => (
  <ThemeCtx.Provider value={theme}>{children}</ThemeCtx.Provider>
);
export const useTheme = () => useContext(ThemeCtx);

/** Safe-area screen scaffold with consistent padding + bg. */
export function Screen({ children, scroll = false, style }: { children: React.ReactNode; scroll?: boolean; style?: ViewStyle }) {
  const t = useTheme();
  const body = (
    <View style={[{ flex: 1, padding: t.space.lg, gap: t.space.lg }, style]}>{children}</View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.surface }}>
      {scroll ? <ScrollView contentContainerStyle={{ flexGrow: 1 }}>{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

type TextVariant = keyof Theme['type'];
export function AppText({ variant = 'body', muted, color, style, children }:
  { variant?: TextVariant; muted?: boolean; color?: string; style?: TextStyle; children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[t.type[variant], { color: color ?? (muted ? t.colors.inkMuted : t.colors.ink) }, style]}>{children}</Text>;
}

export function Button({ title, onPress, variant = 'primary', disabled, loading }:
  { title: string; onPress?: () => void; variant?: 'primary' | 'ghost'; disabled?: boolean; loading?: boolean }) {
  const t = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [{
        borderRadius: t.radius.pill,
        paddingVertical: t.space.md + 2,
        paddingHorizontal: t.space.xl,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: primary ? t.colors.accent : 'transparent',
        borderWidth: primary ? 0 : 1,
        borderColor: t.colors.hairline,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      }]}
    >
      {loading
        ? <ActivityIndicator color={primary ? t.colors.accentInk : t.colors.ink} />
        : <Text style={[t.type.label, { color: primary ? t.colors.accentInk : t.colors.ink }]}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, onPress, style }: { children: React.ReactNode; onPress?: () => void; style?: ViewStyle }) {
  const t = useTheme();
  const s: ViewStyle = {
    backgroundColor: t.colors.surfaceAlt,
    borderRadius: t.radius.lg,
    padding: t.space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.colors.hairline,
    gap: t.space.sm,
    ...t.shadow.card,
  };
  return onPress
    ? <Pressable onPress={onPress} style={({ pressed }) => [s, { opacity: pressed ? 0.9 : 1 }, style]}>{children}</Pressable>
    : <View style={[s, style]}>{children}</View>;
}

export function Field({ label, value, onChangeText, placeholder, secureTextEntry, keyboardType }:
  { label?: string; value: string; onChangeText: (v: string) => void; placeholder?: string; secureTextEntry?: boolean; keyboardType?: 'default' | 'email-address' | 'numeric' }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space.xs }}>
      {label ? <Text style={[t.type.label, { color: t.colors.inkMuted }]}>{label}</Text> : null}
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor={t.colors.inkMuted} secureTextEntry={secureTextEntry} keyboardType={keyboardType}
        style={[t.type.body, {
          color: t.colors.ink, backgroundColor: t.colors.surface,
          borderWidth: 1, borderColor: t.colors.hairline, borderRadius: t.radius.md,
          paddingVertical: t.space.md, paddingHorizontal: t.space.lg,
        }]}
      />
    </View>
  );
}

export function EmptyState({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.space.sm, padding: t.space.xl }}>
      <AppText variant="heading">{title}</AppText>
      {subtitle ? <AppText muted style={{ textAlign: 'center' }}>{subtitle}</AppText> : null}
      {action ? <View style={{ marginTop: t.space.md }}>{action}</View> : null}
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.colors.accent} /></View>;
}
