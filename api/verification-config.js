module.exports = function handler(_request, response) {
    if (_request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return response.status(405).end();
    }

    const appId = process.env.DOJAH_APP_ID;
    const publicKey = process.env.DOJAH_PUBLIC_KEY;
    const widgetId = process.env.DOJAH_WIDGET_ID;

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (!appId || !publicKey || !widgetId) {
        return response.status(503).json({ error: 'Seller identity verification is not configured.' });
    }

    return response.status(200).json({ appId, publicKey, widgetId });
};