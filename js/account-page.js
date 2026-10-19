import { getSupabase } from './supabase.js';
import { getCurrentUser, sendPasswordReset, signIn, signUp } from './auth.js';
import { showMessage } from './ui.js';

const tabs = document.querySelectorAll('[data-mode]');
const forms = document.querySelectorAll('.account-form');
const message = document.querySelector('#account-message');
const title = document.querySelector('#account-title');
const intro = document.querySelector('#account-intro');
let recoveryMode = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';

function setMode(mode) {
    document.querySelectorAll('[data-mode]').forEach((tab) => {
        const selected = tab.dataset.mode === mode;
        tab.setAttribute('aria-selected', String(selected));
    });
    forms.forEach((form) => {
        const visible = form.dataset.panel === mode;
        form.hidden = !visible;
        form.querySelectorAll('input, select').forEach((input) => { input.required = visible; });
    });
    title.textContent = mode === 'login' ? 'Welcome back.' : 'Make room for more.';
    intro.textContent = mode === 'login'
        ? 'Sign in to continue to your Aurevia account.'
        : 'Create an account to save places or submit a property for review.';
    message.hidden = true;
}

tabs.forEach((tab) => tab.addEventListener('click', () => {
    if (!recoveryMode) setMode(tab.dataset.mode);
}));
setMode(window.location.hash === '#register' ? 'register' : 'login');

document.querySelector('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    showMessage(message, 'Signing in…');
    try {
        const result = await signIn(form.elements.email.value.trim(), form.elements.password.value);
        const supabase = await getSupabase();
        const { data: isAdmin, error } = await supabase.rpc('is_admin');
        if (error) throw error;
        window.location.assign(isAdmin ? 'admin.html' : 'dashboard.html');
    } catch (error) {
        showMessage(message, error.message, 'error');
    } finally {
        button.disabled = false;
    }
});

document.querySelector('#register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    showMessage(message, 'Creating your account…');
    try {
        const result = await signUp({
            email: form.elements.email.value.trim(),
            password: form.elements.password.value,
            displayName: form.elements.displayName.value.trim(),
            phone: form.elements.phone.value.trim(),
            accountType: form.elements.accountType.value
        });
        if (result.session) {
            window.location.assign('dashboard.html');
            return;
        }
        showMessage(message, 'Check your email to verify your address, then return here to log in.', 'success');
    } catch (error) {
        showMessage(message, error.message, 'error');
    } finally {
        button.disabled = false;
    }
});

document.querySelector('#forgot-password').addEventListener('click', async () => {
    const email = document.querySelector('#login-form').elements.email.value.trim();
    if (!email) {
        showMessage(message, 'Enter your email address above first.', 'error');
        return;
    }
    try {
        await sendPasswordReset(email);
        showMessage(message, 'If an account exists for that address, a reset link has been sent.', 'success');
    } catch (error) {
        showMessage(message, error.message, 'error');
    }
});

document.querySelector('#recovery-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
        const supabase = await getSupabase();
        if (!supabase) throw new Error('Supabase is not configured.');
        const { error } = await supabase.auth.updateUser({ password: event.currentTarget.elements.password.value });
        if (error) throw error;
        recoveryMode = false;
        event.currentTarget.hidden = true;
        setMode('login');
        showMessage(message, 'Password updated. You can now sign in.', 'success');
    } catch (error) {
        showMessage(message, error.message, 'error');
    }
});

const recoveryForm = document.querySelector('#recovery-form');
const supabase = await getSupabase();
if (!supabase) {
    showMessage(message, 'Backend not configured yet. Add the Supabase URL and anon key, apply the migration, then reload.', 'error');
} else {
    if (recoveryMode) {
        forms.forEach((form) => { form.hidden = form !== recoveryForm; });
        recoveryForm.querySelector('input').required = true;
        title.textContent = 'Choose a new password.';
        intro.textContent = 'Use at least 10 characters.';
    }
    supabase.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
            recoveryMode = true;
            forms.forEach((form) => { form.hidden = form !== recoveryForm; });
            recoveryForm.querySelector('input').required = true;
            title.textContent = 'Choose a new password.';
            intro.textContent = 'Use at least 10 characters.';
        }
    });
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data.session?.user && !recoveryMode) window.location.assign('dashboard.html');
    } catch (error) {
        showMessage(message, error.message, 'error');
    }
}
