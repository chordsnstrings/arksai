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

/* ────────────────────────────────────────────────────────────────────────────
   Premium layer — the components large apps otherwise hand-roll (and get wrong).
   Same rules as above: token-driven, pressed/disabled states, light+dark, no
   extra dependencies beyond what Expo ships (@expo/vector-icons is bundled).
   ──────────────────────────────────────────────────────────────────────────── */
import { Modal, Switch, Animated, Easing } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

/** Screen header: title + optional back + optional right action. Use on pushed screens. */
export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingBottom: t.space.sm }}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: t.space.xs })}>
          <Ionicons name="chevron-back" size={24} color={t.colors.ink} />
        </Pressable>
      ) : null}
      <Text style={[t.type.title, { color: t.colors.ink, flex: 1 }]} numberOfLines={1}>{title}</Text>
      {right}
    </View>
  );
}

/** List row: title/subtitle + optional left element, right element or chevron. The
 *  building block of every settings/list screen — never hand-roll row layout. */
export function ListRow({ title, subtitle, left, right, chevron, onPress }:
  { title: string; subtitle?: string; left?: React.ReactNode; right?: React.ReactNode; chevron?: boolean; onPress?: () => void }) {
  const t = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingVertical: t.space.md }}>
      {left}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[t.type.body, { color: t.colors.ink }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[t.type.caption, { color: t.colors.inkMuted }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={t.colors.inkMuted} /> : null}
    </View>
  );
  return onPress
    ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>{body}</Pressable>
    : body;
}

/** Hairline divider for row lists. */
export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.colors.hairline }} />;
}

/** Uppercase eyebrow label that opens a group of rows/cards. */
export function SectionHeader({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Text style={[t.type.caption, { color: t.colors.inkMuted, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: t.space.md }]}>
      {children}
    </Text>
  );
}

/** Search input with icon + clear. */
export function SearchBar({ value, onChangeText, placeholder = 'Search…' }:
  { value: string; onChangeText: (v: string) => void; placeholder?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radius.pill, paddingHorizontal: t.space.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.hairline }}>
      <Ionicons name="search" size={17} color={t.colors.inkMuted} />
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor={t.colors.inkMuted} returnKeyType="search"
        style={[t.type.body, { flex: 1, color: t.colors.ink, paddingVertical: t.space.md }]}
      />
      {value ? (
        <Pressable accessibilityLabel="Clear search" onPress={() => onChangeText('')} hitSlop={8}>
          <Ionicons name="close-circle" size={17} color={t.colors.inkMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Selectable pill (filters, categories). */
export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: t.space.sm, paddingHorizontal: t.space.lg, borderRadius: t.radius.pill,
        backgroundColor: selected ? t.colors.accent : t.colors.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth, borderColor: selected ? t.colors.accent : t.colors.hairline,
        opacity: pressed ? 0.8 : 1,
      })}>
      <Text style={[t.type.label, { color: selected ? t.colors.accentInk : t.colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

/** Settings row with a value, a switch, or navigation. */
export function SettingRow({ label, value, onPress, switchValue, onSwitch }:
  { label: string; value?: string; onPress?: () => void; switchValue?: boolean; onSwitch?: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <ListRow
      title={label}
      onPress={onPress}
      chevron={!!onPress && onSwitch === undefined}
      right={
        onSwitch !== undefined
          ? <Switch value={!!switchValue} onValueChange={onSwitch} trackColor={{ true: t.colors.accent }} thumbColor={t.colors.surface} />
          : value
            ? <Text style={[t.type.body, { color: t.colors.inkMuted }]}>{value}</Text>
            : undefined
      }
    />
  );
}

/** Initials avatar (deterministic tint from the name). */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const t = useTheme();
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: t.colors.accentInk, fontWeight: '700', fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}

/** Inline notice: info | success | danger. Use for form errors and confirmations. */
export function Banner({ kind = 'info', children }: { kind?: 'info' | 'success' | 'danger'; children: React.ReactNode }) {
  const t = useTheme();
  const color = kind === 'success' ? t.colors.success : kind === 'danger' ? t.colors.danger : t.colors.inkMuted;
  return (
    <View style={{ flexDirection: 'row', gap: t.space.sm, alignItems: 'flex-start', backgroundColor: t.colors.surfaceAlt, borderRadius: t.radius.md, padding: t.space.md, borderLeftWidth: 3, borderLeftColor: color }}>
      <Text style={[t.type.caption, { color: t.colors.ink, flex: 1 }]}>{children}</Text>
    </View>
  );
}

/** Floating action button (one per screen, the primary create action). */
export function FAB({ icon = 'add', onPress, label }: { icon?: keyof typeof Ionicons.glyphMap; onPress: () => void; label?: string }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? 'Add'} onPress={onPress}
      style={({ pressed }) => ({
        position: 'absolute', right: t.space.xl, bottom: t.space.xl,
        width: 56, height: 56, borderRadius: 28, backgroundColor: t.colors.accent,
        alignItems: 'center', justifyContent: 'center',
        opacity: pressed ? 0.85 : 1, ...t.shadow.card,
      })}>
      <Ionicons name={icon} size={26} color={t.colors.accentInk} />
    </Pressable>
  );
}

/** Progress bar (0..1). */
export function ProgressBar({ value }: { value: number }) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View accessibilityRole="progressbar" style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: t.colors.accent, borderRadius: 3 }} />
    </View>
  );
}

/** Bottom sheet on RN Modal — pass open/onClose; content gets safe padding. */
export function Sheet({ open, onClose, title, children }:
  { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} accessibilityLabel="Close" />
      <View style={{ backgroundColor: t.colors.surface, borderTopLeftRadius: t.radius.xl, borderTopRightRadius: t.radius.xl, padding: t.space.xl, gap: t.space.md, paddingBottom: t.space.xxl }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: t.colors.hairline, alignSelf: 'center' }} />
        {title ? <AppText variant="heading">{title}</AppText> : null}
        {children}
      </View>
    </Modal>
  );
}

/** Toast — mount <ToastHost/> once in the root layout, then useToast()('Saved'). */
const ToastCtx = createContext<(msg: string, kind?: 'info' | 'danger') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const [msg, setMsg] = React.useState<{ text: string; kind: 'info' | 'danger' } | null>(null);
  const fade = React.useRef(new Animated.Value(0)).current;
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = React.useCallback((text: string, kind: 'info' | 'danger' = 'info') => {
    setMsg({ text, kind });
    Animated.timing(fade, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setMsg(null));
    }, 2200);
  }, [fade]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg ? (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 20, right: 20, bottom: 40, opacity: fade, backgroundColor: msg.kind === 'danger' ? t.colors.danger : t.colors.ink, borderRadius: t.radius.md, padding: t.space.md + 2, alignItems: 'center' }}>
        <Text style={[t.type.label, { color: t.colors.surface }]}>{msg.text}</Text>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}
