module.exports = function handler(_request, response) {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (!url || !anonKey) {
        return response.status(503).json({ error: 'Supabase is not configured for this deployment yet.' });
    }

    return response.status(200).json({ url, anonKey });
};
