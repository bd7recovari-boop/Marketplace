import { getSupabase } from './js/supabase.js';
import { getImages, searchProperties } from './js/properties.js';
import { formatNaira } from './js/ui.js';

const menuToggle = document.querySelector('.menu-toggle');
const primaryNav = document.querySelector('#primary-nav');
const searchForm = document.querySelector('#property-search');
const searchFeedback = document.querySelector('#search-feedback');
const listingContainer = document.querySelector('#listings-empty').parentElement;
const emptyState = document.querySelector('#listings-empty');
let searchSequence = 0;

function setPurpose(purpose) {
	searchForm.elements.namedItem('purpose').value = purpose;
	document.querySelectorAll('[data-search-purpose]').forEach((button) => {
		const selected = button.dataset.searchPurpose === purpose;
		button.classList.toggle('is-active', selected);
		button.setAttribute('aria-pressed', String(selected));
	});
}

function appendPropertyCard(property, image) {
	const card = document.createElement('a');
	card.className = 'property-card';
	card.href = `property.html?id=${encodeURIComponent(property.id)}`;
	const media = document.createElement('div');
	media.className = 'property-card-media';
	if (image?.url) {
		const photo = document.createElement('img');
		photo.src = image.url;
		photo.alt = image.alt_text || property.title;
		photo.loading = 'lazy';
		media.append(photo);
	}
	const badge = document.createElement('span');
	badge.className = 'property-card-badge';
	badge.textContent = property.purpose === 'sale' ? 'For sale' : property.purpose === 'rent' ? 'For rent' : 'Short-let';
	media.append(badge);
	const body = document.createElement('div');
	body.className = 'property-card-body';
	const title = document.createElement('h3');
	title.textContent = property.title;
	const location = document.createElement('p');
	location.className = 'property-card-location';
	location.textContent = [property.area, property.city, property.state].filter(Boolean).join(', ');
	const price = document.createElement('p');
	price.className = 'property-card-price';
	price.textContent = formatNaira(property.price);
	const details = document.createElement('p');
	details.className = 'property-card-details';
	details.textContent = [property.bedrooms ? `${property.bedrooms} beds` : '', property.bathrooms ? `${property.bathrooms} baths` : '', property.size_sqm ? `${property.size_sqm} m²` : ''].filter(Boolean).join('  ·  ');
	body.append(title, location, price, details);
	card.append(media, body);
	return card;
}

async function loadProperties(filters = {}) {
	const sequence = ++searchSequence;
	searchFeedback.textContent = 'Finding approved listings…';
	emptyState.hidden = true;
	let grid = document.querySelector('.property-grid');
	if (!grid) {
		grid = document.createElement('div');
		grid.className = 'property-grid';
		grid.setAttribute('aria-live', 'polite');
		listingContainer.insertBefore(grid, emptyState);
	}
	grid.replaceChildren();

	try {
		const properties = await searchProperties(filters);
		if (sequence !== searchSequence) return;
		if (!properties.length) {
			grid.hidden = true;
			emptyState.hidden = false;
			emptyState.querySelector('h3').textContent = 'No approved homes to show yet.';
			emptyState.querySelector('p:not(.eyebrow)').textContent = 'Approved listings will appear here after the Aurevia review team verifies the property and supporting evidence.';
			searchFeedback.textContent = 'No approved properties match these filters.';
			return;
		}
		const images = await getImages(properties.map((property) => property.id));
		if (sequence !== searchSequence) return;
		const firstImageByProperty = new Map();
		for (const image of images) {
			if (image.url && !firstImageByProperty.has(image.property_id)) firstImageByProperty.set(image.property_id, image);
		}
		grid.append(...properties.map((property) => appendPropertyCard(property, firstImageByProperty.get(property.id))));
		grid.hidden = false;
		emptyState.hidden = true;
		searchFeedback.textContent = `${properties.length} approved ${properties.length === 1 ? 'property' : 'properties'} found.`;
	} catch (error) {
		if (sequence !== searchSequence) return;
		grid.hidden = true;
		emptyState.hidden = false;
		emptyState.querySelector('h3').textContent = 'Property search is unavailable.';
		emptyState.querySelector('p:not(.eyebrow)').textContent = error.message;
		searchFeedback.textContent = 'Search could not be completed.';
	}
}

menuToggle?.addEventListener('click', () => {
	const expanded = menuToggle.getAttribute('aria-expanded') === 'true';
	menuToggle.setAttribute('aria-expanded', String(!expanded));
	menuToggle.setAttribute('aria-label', expanded ? 'Open navigation' : 'Close navigation');
	primaryNav.classList.toggle('is-open', !expanded);
});

primaryNav?.addEventListener('click', (event) => {
	if (event.target.closest('a')) {
		menuToggle.setAttribute('aria-expanded', 'false');
		menuToggle.setAttribute('aria-label', 'Open navigation');
		primaryNav.classList.remove('is-open');
	}
});

document.querySelectorAll('[data-search-purpose]').forEach((button) => {
	button.addEventListener('click', () => setPurpose(button.dataset.searchPurpose));
});
document.querySelectorAll('[data-purpose-link]').forEach((link) => {
	link.addEventListener('click', () => setPurpose(link.dataset.purposeLink));
});
document.querySelectorAll('[data-focus-field]').forEach((button) => {
	button.addEventListener('click', () => {
		const field = searchForm.elements.namedItem(button.dataset.focusField);
		document.querySelector('#search').scrollIntoView({ behavior: 'smooth', block: 'center' });
		field.focus({ preventScroll: true });
	});
});

searchForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	const values = new FormData(searchForm);
	const minPrice = Number(values.get('minPrice')) || null;
	const maxPrice = Number(values.get('maxPrice')) || null;
	if (minPrice && maxPrice && minPrice > maxPrice) {
		searchFeedback.textContent = 'Minimum price must not exceed maximum price.';
		return;
	}
	await loadProperties({
		purpose: values.get('purpose'),
		type: values.get('type'),
		location: values.get('location'),
		minPrice,
		maxPrice
	});
});

document.querySelectorAll('[data-notice]').forEach((button) => {
	button.addEventListener('click', () => window.location.assign('account.html'));
});

document.querySelector('#current-year').textContent = new Date().getFullYear();
const configuredSupabase = await getSupabase();
if (configuredSupabase) {
	await loadProperties();
} else {
	searchFeedback.textContent = 'Marketplace setup is in progress. Search will activate when the backend is connected.';
}
