import { formatNaira, showMessage } from './ui.js';
import { getImages } from './properties.js';
import { requireSupabase } from './supabase.js';

const message = document.querySelector('#property-message');
const article = document.querySelector('#property-detail');
const propertyId = new URLSearchParams(window.location.search).get('id');

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
    const gallery = document.querySelector('#property-gallery');
    gallery.replaceChildren();
    for (const image of images) {
        if (!image.url) continue;
        const photo = document.createElement('img');
        photo.src = image.url;
        photo.alt = image.alt_text || property.title;
        gallery.append(photo);
    }
    if (!gallery.children.length) throw new Error('Approved listing photos are temporarily unavailable.');

    const { data: contact, error: contactError } = await supabase.rpc('public_property_contact', { target_property_id: property.id });
    if (contactError) throw contactError;
    const contactInfo = contact?.[0];
    if (contactInfo?.phone) {
        text(document.querySelector('#contact-name'), contactInfo.display_name || 'Property owner / agent');
        text(document.querySelector('#contact-phone'), contactInfo.phone);
        const digits = contactInfo.phone.replace(/\D/g, '');
        const contactLink = document.querySelector('#contact-link');
        contactLink.href = `https://wa.me/${digits}?text=${encodeURIComponent(`Hello, I am enquiring about ${property.title} on Aurevia.`)}`;
    } else {
        document.querySelector('.property-contact').hidden = true;
    }

    article.hidden = false;
    message.hidden = true;
}

try {
    await loadProperty();
} catch (error) {
    showMessage(message, error.message, 'error');
}
