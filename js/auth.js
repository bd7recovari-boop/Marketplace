import { requireSupabase } from './supabase.js';

export async function getCurrentUser() {
    const supabase = await requireSupabase();
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return { supabase, user: data.user };
}

export async function signUp({ email, password, displayName, phone, accountType }) {
    const supabase = await requireSupabase();
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { display_name: displayName, phone, account_type: accountType }
        }
    });
    if (error) throw error;
    return data;
}

export async function signIn(email, password) {
    const supabase = await requireSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

export async function signOut() {
    const supabase = await requireSupabase();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}

export async function sendPasswordReset(email) {
    const supabase = await requireSupabase();
    const redirectTo = new URL('account.html', window.location.href).href;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
}

export async function resendVerification(email) {
    const supabase = await requireSupabase();
    const redirectTo = new URL('account.html', window.location.href).href;
    const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: redirectTo }
    });
    if (error) throw error;
}
