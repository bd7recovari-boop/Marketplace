const crypto = require('node:crypto');
const { createAdminClient } = require('@supabase/server/core');

async function readRawBody(request) {
    const chunks = [];
    let totalLength = 0;
    for await (const chunk of request) {
        totalLength += chunk.length;
        if (totalLength > 1024 * 1024) {
            const error = new Error('Request body too large');
            error.statusCode = 413;
            throw error;
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

function isValidSignature(body, signature, secret) {
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = crypto.createHmac('sha256', secret).update(body).digest();
    return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).end();
    }

    const webhookSecret = process.env.DOJAH_WEBHOOK_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
        return response.status(503).json({ error: 'Webhook is not configured.' });
    }

    let rawBody;
    try {
        rawBody = await readRawBody(request);
    } catch (error) {
        return response.status(error.statusCode || 400).end();
    }

    if (!isValidSignature(rawBody, request.headers['x-dojah-signature'], webhookSecret)) {
        return response.status(401).end();
    }

    let event;
    try {
        event = JSON.parse(rawBody.toString('utf8'));
    } catch {
        return response.status(400).end();
    }

    const reference = event.reference_id;
    if (typeof reference !== 'string' || !/^AUR-[a-f0-9]{32}$/i.test(reference)) {
        return response.status(200).json({ received: true });
    }

    const status = event.verification_status;
    if (!['Completed', 'Failed', 'Abandoned'].includes(status)) {
        return response.status(200).json({ received: true });
    }

    const passed = status === 'Completed'
        && event.status === true
        && event.id_type === 'NIN'
        && event.data?.government_data?.status === true
        && event.data?.selfie?.status === true;

    try {
        const supabaseAdmin = createAdminClient({
            env: {
                url: supabaseUrl,
                secretKeys: { default: serviceRoleKey }
            }
        });
        const { error } = await supabaseAdmin.rpc('complete_seller_identity_verification', {
            target_reference: reference,
            verification_passed: passed
        });
        if (error) {
            return response.status(502).json({ error: 'Could not update verification status.' });
        }
    } catch {
        return response.status(502).json({ error: 'Could not update verification status.' });
    }

    return response.status(200).json({ received: true });
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };