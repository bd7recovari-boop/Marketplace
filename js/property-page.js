import { formatNaira, showMessage } from './ui.js';
import { getImages } from './properties.js';
import { requireSupabase } from './supabase.js';

const message = document.querySelector('#property-message');
const article = document.querySelector('#property-detail');
const propertyId = new URLSearchParams(window.location.search).get('id');
const reportForm = document.querySelector('#property-report-form');
const reportMessage = document.querySelector('#report-message');

function text(target, value) {
    target.textContent = value ?? '';
}

async function loadProperty() {
    if (!propertyId || !/^[0-9a-f-]{36}$/i.test(propertyId)) {
        throw new Error('This property link is invalid. Return to search and choose an approved listing.');
    }
    const supabase = await requireSupabase();
    const { data: property, error } = await supabase.from('properties')
        .select('id, title, description, property_type, purpose, price, currency, state, city, area, bedrooms, bathrooms, size_sqm, amenities')
        .eq('id', propertyId)
        .eq('status', 'approved')
        .maybeSingle();
    if (error) throw error;
    if (!property) throw new Error('This listing is unavailable or has not been approved for publication.');

    document.title = `${property.title} | Aurevia`;
    const setMeta = (selector, content) => {
        const meta = document.querySelector(selector);
        if (meta) meta.setAttribute('content', content);
    };
    setMeta('meta[name="description"]', `${property.title} in ${[property.area, property.city, property.state].filter(Boolean).join(', ')}. View this ${property.purpose} listing on Aurevia.`);
    setMeta('meta[property="og:title"]', `${property.title} | Aurevia`);
    setMeta('meta[property="og:description"]', `${property.property_type} in ${[property.area, property.city, property.state].filter(Boolean).join(', ')}.`);

    text(document.querySelector('#property-type-label'), `${property.property_type} · ${property.purpose}`);
    text(document.querySelector('#property-title'), property.title);
    text(document.querySelector('#property-location'), [property.area, property.city, property.state].filter(Boolean).join(', '));
    text(document.querySelector('#property-price'), formatNaira(property.price));
    text(document.querySelector('#property-description'), property.description);

    const facts = document.querySelector('#property-facts');
    facts.replaceChildren();
    for (const [label, value] of [['Bedrooms', property.bedrooms], ['Bathrooms', property.bathrooms], ['Size', property.size_sqm ? `${property.size_sqm} m²` : null]]) {
        if (value === null || value === undefined) continue;
        const fact = document.createElement('div');
        fact.className = 'property-fact';
        const strong = document.createElement('strong');
        strong.textContent = String(value);
        const caption = document.createElement('span');
        caption.textContent = label;
        fact.append(strong, caption);
        facts.append(fact);
    }

    const amenities = document.querySelector('#property-amenities');
    amenities.replaceChildren();
    for (const amenity of property.amenities ?? []) {
        const item = document.createElement('li');
        item.textContent = amenity;
        amenities.append(item);
    }

    const images = await getImages([property.id]);
    const shareImage = images.find((image) => image.url)?.url;
    if (shareImage) {
        setMeta('meta[property="og:image"]', shareImage);
        setMeta('meta[name="twitter:image"]', shareImage);
    }
    const gallery = document.querySelector('#property-gallery');
    gallery.replaceChildren();
    for (const image of images) {
        if (!image.url) continue;
        const photo = document.createElement('img');
        photo.src = image.url;
        photo.alt = image.alt_text || property.title;
        photo.loading = 'lazy';
        photo.decoding = 'async';
        photo.addEventListener('error', () => {
            photo.src = 'estate 5.avif';
            photo.alt = `${property.title} placeholder image`;
        }, { once: true });
        gallery.append(photo);
    }
    if (!gallery.children.length) {
        const fallback = document.createElement('img');
        fallback.src = 'estate 5.avif';
        fallback.alt = 'Aurevia property placeholder';
        fallback.loading = 'eager';
        fallback.decoding = 'async';
        gallery.append(fallback);
    }

    const { data: contact, error: contactError } = await supabase.rpc('public_property_contact', { target_property_id: property.id });
    if (contactError) throw contactError;
    const contactInfo = contact?.[0];
    if (contactInfo?.phone) {
        text(document.querySelector('#contact-name'), contactInfo.display_name || 'Property owner / agent');
        text(document.querySelector('#contact-phone'), contactInfo.phone);
        let digits = contactInfo.phone.replace(/\D/g, '');
        if (digits.startsWith('0')) digits = `234${digits.slice(1)}`;
        if (digits.length === 10) digits = `234${digits}`;
        const contactLink = document.querySelector('#contact-link');
        contactLink.href = `https://wa.me/${digits}?text=${encodeURIComponent(`Hello, I am enquiring about ${property.title} on Aurevia. ${window.location.href}`)}`;
    } else {
        document.querySelector('.property-contact').hidden = true;
    }

    article.hidden = false;
    message.hidden = true;
    const returnTo = `property.html?id=${encodeURIComponent(property.id)}`;
    document.querySelector('#report-sign-in-link').href = `account.html?returnTo=${encodeURIComponent(returnTo)}#login`;

    const shareButton = document.querySelector('#property-share');
    shareButton.addEventListener('click', async () => {
        const shareData = { title: property.title, text: `${property.title} in ${[property.area, property.city, property.state].filter(Boolean).join(', ')}`, url: window.location.href };
        try {
            if (navigator.share) {
                await navigator.share(shareData);
            } else if (navigator.clipboard) {
                await navigator.clipboard.writeText(window.location.href);
                shareButton.textContent = 'Link copied';
                window.setTimeout(() => { shareButton.textContent = 'Share listing'; }, 1800);
            } else {
                window.prompt('Copy this property link:', window.location.href);
            }
        } catch (error) {
            if (error?.name !== 'AbortError') showMessage(message, 'This listing could not be shared. Copy the address from your browser instead.', 'error');
        }
    });
}

reportForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = reportForm.querySelector('[type="submit"]');
    button.disabled = true;
    document.querySelector('#report-sign-in').hidden = true;
    try {
        const supabase = await requireSupabase();
        const { data, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!data.user) {
            document.querySelector('#report-sign-in').hidden = false;
            showMessage(reportMessage, 'Sign in to submit a report.', 'error');
            return;
        }
        const { error } = await supabase.rpc('submit_property_report', {
            target_property_id: propertyId,
            report_reason: reportForm.elements.reason.value,
            report_details: reportForm.elements.details.value.trim()
        });
        if (error?.code === '23505') throw new Error('You have already reported this listing.');
        if (error) throw error;
        reportForm.reset();
        showMessage(reportMessage, 'Report sent to Aurevia for review.', 'success');
    } catch (error) {
        showMessage(reportMessage, error.message, 'error');
    } finally {
        button.disabled = false;
    }
});

try {
    await loadProperty();
} catch (error) {
    showMessage(message, error.message, 'error');
}
