let clientPromise;

async function readConfig() {
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (!isLocal) {
        try {
            const response = await fetch('/api/config', { cache: 'no-store' });
            if (response.ok) {
                return await response.json();
            }
        } catch {
            // Fall back to ignored local config if the deployment function is unavailable.
        }
    }

    try {
        const localConfig = await import('./config.local.js');
        return { url: localConfig.supabaseUrl, anonKey: localConfig.supabaseAnonKey };
    } catch {
        return null;
    }
}

export async function getSupabase() {
    if (!clientPromise) {
        clientPromise = readConfig().then(async (config) => {
            if (!config?.url || !config?.anonKey || config.url.includes('YOUR_PROJECT_ID')) {
                return null;
            }
            const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
            return createClient(config.url, config.anonKey, {
                auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
            });
        });
    }
    return clientPromise;
}

export async function requireSupabase() {
    const client = await getSupabase();
    if (!client) {
        throw new Error('Supabase is not configured. Add your project URL and anon key, then reload.');
    }
    return client;
}
