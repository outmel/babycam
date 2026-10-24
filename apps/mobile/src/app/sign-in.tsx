import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Button, Field, Segmented, T } from '@/components/ui';
import { Space, useTheme } from '@/constants/theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function SignIn() {
  const t = useTheme();
  const { refreshMemberships } = useSession();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'alert' | 'ok'; text: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    const creds = { email: email.trim(), password };
    const { data, error } = mode === 'in' ? await supabase.auth.signInWithPassword(creds) : await supabase.auth.signUp(creds);
    setBusy(false);
    if (error) return setMessage({ tone: 'alert', text: error.message });
    if (!data.session) return setMessage({ tone: 'ok', text: 'Check your email to confirm your account, then sign in.' });
    await refreshMemberships();
    router.replace('/');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: Space.xl, gap: Space.lg }}>
        <View style={{ gap: Space.xs }}>
          <T variant="title">Lulu</T>
          <T variant="muted">A private baby monitor made from two phones. Video never leaves the camera phone.</T>
        </View>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'in', label: 'Sign in' }, { value: 'up', label: 'Create account' }]} />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'in' ? 'password' : 'new-password'} />
        {message && <Banner tone={message.tone} text={message.text} />}
        <Button title={mode === 'in' ? 'Sign in' : 'Create account'} onPress={submit} loading={busy} disabled={!email || password.length < 6} />
        <T variant="small">Use the same account on the camera phone and your own phone, or invite others from Family.</T>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
