import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Radius, Space, useTheme } from '@/constants/theme';

export function Screen({ children, scroll = true, padded = true }: { children: ReactNode; scroll?: boolean; padded?: boolean }) {
  const t = useTheme();
  const inner = <View style={[padded && styles.padded, { gap: Space.lg }]}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.background }} edges={['bottom', 'left', 'right']}>
      {scroll ? <ScrollView contentContainerStyle={{ paddingBottom: Space.xxl }}>{inner}</ScrollView> : inner}
    </SafeAreaView>
  );
}

type TextVariant = 'title' | 'heading' | 'body' | 'muted' | 'small' | 'label';

export function T({ children, variant = 'body', style, numberOfLines }: { children: ReactNode; variant?: TextVariant; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const t = useTheme();
  const base: Record<TextVariant, TextStyle> = {
    title: { fontSize: 28, fontWeight: '700', color: t.text, letterSpacing: -0.4 },
    heading: { fontSize: 18, fontWeight: '600', color: t.text },
    body: { fontSize: 16, color: t.text, lineHeight: 22 },
    muted: { fontSize: 15, color: t.textMuted, lineHeight: 21 },
    small: { fontSize: 13, color: t.textMuted },
    label: { fontSize: 13, fontWeight: '600', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  };
  return (
    <Text style={[base[variant], style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.accent : variant === 'danger' ? t.alert : variant === 'secondary' ? t.surfaceAlt : 'transparent';
  const fg = variant === 'primary' ? t.accentText : variant === 'danger' ? '#fff' : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'ghost' && { borderWidth: 1, borderColor: t.border },
        style,
      ]}>
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 16, fontWeight: '600' }}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const t = useTheme();
  const s = [styles.card, { backgroundColor: t.surface, borderColor: t.border }, style];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s, pressed && { opacity: 0.9 }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={s}>{children}</View>;
}

export function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: color + '22' }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={{ color, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={{ gap: Space.xs }}>
      <T variant="label">{label}</T>
      <TextInput
        placeholderTextColor={t.textMuted}
        {...props}
        style={[styles.input, { backgroundColor: t.surface, borderColor: t.border, color: t.text }, props.style]}
      />
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: Space.sm }, style]}>{children}</View>;
}

export function Segmented<V extends string>({ value, options, onChange }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: t.surfaceAlt }]}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          style={[styles.segment, o.value === value && { backgroundColor: t.surface }]}>
          <Text style={{ color: t.text, fontWeight: o.value === value ? '600' : '400' }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Banner({ text, tone = 'info' }: { text: string; tone?: 'info' | 'warning' | 'alert' | 'ok' }) {
  const t = useTheme();
  const c = t[tone];
  return (
    <View style={[styles.banner, { backgroundColor: c + '1F', borderColor: c + '55' }]}>
      <Text style={{ color: t.text, fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  padded: { paddingHorizontal: Space.lg, paddingTop: Space.lg },
  button: { minHeight: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.lg },
  card: { borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: Space.lg, gap: Space.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.pill, alignSelf: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  input: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Space.md, paddingVertical: Space.md, fontSize: 16 },
  segmented: { flexDirection: 'row', borderRadius: Radius.md, padding: 3 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: Radius.sm },
  banner: { borderRadius: Radius.md, borderWidth: 1, padding: Space.md },
});
