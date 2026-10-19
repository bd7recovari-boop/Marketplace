import { getCurrentUser, signOut } from './auth.js';
import { getOwnProperties, submitProperty } from './properties.js';
import { formatNaira, showMessage } from './ui.js';

const dashboardMessage = document.querySelector('#dashboard-message');
const tableBody = document.querySelector('#listing-rows');
const listingPanel = document.querySelector('#listing-panel');
const listingForm = document.querySelector('#listing-form');
const listingError = document.querySelector('#listing-error');
const profilePanel = document.querySelector('#profile-panel');
const profileForm = document.querySelector('#profile-form');
let supabase;
let currentUser;
let profile;
let editingPropertyId = null;
let existingImages = [];
let existingDocuments = [];

function addCell(row, text, className = '') {
    const cell = document.createElement('td');
    cell.textContent = text;
    if (className) cell.className = className;
    row.append(cell);
    return cell;
}

function renderListings(properties) {
    tableBody.replaceChildren();
    if (!properties.length) {
        const row = document.createElement('tr');
        const cell = addCell(row, 'Your submitted properties and review feedback will appear here.', 'empty-row');
        cell.colSpan = 6;
        tableBody.append(row);
        return;
    }

    for (const property of properties) {
        const row = document.createElement('tr');
        addCell(row, property.title);
        addCell(row, [property.city, property.state].filter(Boolean).join(', '));
        addCell(row, `${property.purpose} · ${formatNaira(property.price)}`);
        const statusCell = document.createElement('td');
        const status = document.createElement('span');
        status.className = `status-tag ${property.status}`;
        status.textContent = property.status;
        statusCell.append(status);
        if (property.status === 'rejected' && property.rejection_reason) {
            const reason = document.createElement('div');
            reason.className = 'review-meta';
            reason.textContent = property.rejection_reason;
            statusCell.append(reason);
        }
        row.append(statusCell);
        addCell(row, new Date(property.created_at).toLocaleDateString());
        const actionCell = document.createElement('td');
        if (property.status === 'pending') {
            const edit = document.createElement('button');
            edit.className = 'inline-link';
            edit.type = 'button';
            edit.textContent = 'Edit listing';
            edit.addEventListener('click', () => openEdit(property.id));
            actionCell.append(edit, document.createElement('br'), 'Awaiting review');
        } else if (property.status === 'rejected') {
            const edit = document.createElement('button');
            edit.className = 'inline-link';
            edit.type = 'button';
            edit.textContent = 'Edit & resubmit';
            edit.addEventListener('click', () => openEdit(property.id));
            actionCell.append(edit);
        } else {
            actionCell.textContent = 'Published';
        }
        row.append(actionCell);
        tableBody.append(row);
    }
}

async function refreshListings() {
    const { data, error } = await supabase.rpc('my_properties');
    if (error) throw error;
    renderListings(data ?? []);
}

function clearListingForm() {
    listingForm.reset();
    editingPropertyId = null;
    existingImages = [];
    existingDocuments = [];
    document.querySelector('#existing-images').replaceChildren();
    document.querySelector('#existing-documents').replaceChildren();
    listingForm.elements.images.required = true;
    listingForm.elements.document.required = true;
    listingForm.elements.location_document.required = true;
    if (profile?.account_type === 'agent') listingForm.elements.document_type.value = 'right-to-list';
    document.querySelector('#listing-form-title').textContent = 'Share a property';
    document.querySelector('#listing-panel > p').textContent = 'Your listing stays private until an Aurevia administrator has reviewed it and supporting documents.';
    listingError.hidden = true;
}

function renderExistingMedia(container, files, bucket, field) {
    container.replaceChildren();
    for (const file of files) {
        const item = document.createElement('div');
        item.className = 'existing-media-item';
        if (bucket === 'property-images' && file.url) {
            const image = document.createElement('img');
            image.src = file.url;
            image.alt = file.alt_text || 'Uploaded property image';
            image.loading = 'lazy';
            item.append(image);
        } else {
            const name = document.createElement('span');
            name.textContent = file.document_type;
            item.append(name);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'inline-link';
        remove.textContent = 'Remove';
        remove.addEventListener('click', async () => {
            remove.disabled = true;
            try {
                const table = bucket === 'property-images' ? 'property_images' : 'property_verification_documents';
                const { error: rowError } = await supabase.from(table).delete().eq('id', file.id);
                if (rowError) throw rowError;
                const { error: fileError } = await supabase.storage.from(bucket).remove([file.object_path]);
                if (fileError) throw fileError;
                if (bucket === 'property-images') existingImages = existingImages.filter((image) => image.id !== file.id);
                else existingDocuments = existingDocuments.filter((document) => document.id !== file.id);
                renderExistingMedia(container, bucket === 'property-images' ? existingImages : existingDocuments, bucket, field);
                if (bucket === 'property-images') listingForm.elements.images.required = existingImages.length === 0;
                if (bucket === 'verification-documents') {
                    const requiredType = profile.account_type === 'agent' ? 'right-to-list' : 'ownership-proof';
                    listingForm.elements.document.required = !existingDocuments.some((document) => document.document_type === requiredType);
                    listingForm.elements.location_document.required = !existingDocuments.some((document) => ['survey-plan', 'address-proof'].includes(document.document_type));
                }
            } catch (error) {
                showMessage(listingError, error.message, 'error');
                remove.disabled = false;
            }
        });
        item.append(remove);
        container.append(item);
    }
}

function openNewListing() {
    clearListingForm();
    listingPanel.hidden = false;
    profilePanel.hidden = true;
    listingPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function openEdit(propertyId) {
    try {
        const { data: property, error } = await supabase
            .from('properties')
            .select('id, title, description, property_type, purpose, price, state, city, area, bedrooms, bathrooms, size_sqm, amenities, status')
            .eq('id', propertyId)
            .single();
        if (error) throw error;
        const { data: privateDetails, error: addressError } = await supabase
            .from('property_private_details')
            .select('full_address')
            .eq('property_id', propertyId)
            .single();
        if (addressError) throw addressError;
        const { data: documents, error: documentError } = await supabase
            .from('property_verification_documents')
            .select('id, document_type, object_path')
            .eq('property_id', propertyId);
        if (documentError) throw documentError;
        const { data: images, error: imageError } = await supabase
            .from('property_images')
            .select('id, object_path, alt_text, sort_order')
            .eq('property_id', propertyId)
            .order('sort_order');
        if (imageError) throw imageError;

        clearListingForm();
        editingPropertyId = propertyId;
        const controls = listingForm.elements;
        for (const field of ['title', 'description', 'property_type', 'purpose', 'price', 'state', 'city', 'area', 'bedrooms', 'bathrooms', 'size_sqm']) {
            controls[field].value = property[field] ?? '';
        }
        controls.amenities.value = (property.amenities ?? []).join(', ');
        controls.address.value = privateDetails.full_address;
        controls.images.required = true;
        existingImages = await Promise.all((images ?? []).map(async (image) => {
            const { data: signed } = await supabase.storage.from('property-images').createSignedUrl(image.object_path, 600);
            return { ...image, url: signed?.signedUrl ?? '' };
        }));
        existingDocuments = documents ?? [];
        renderExistingMedia(document.querySelector('#existing-images'), existingImages, 'property-images', 'images');
        renderExistingMedia(document.querySelector('#existing-documents'), existingDocuments, 'verification-documents', 'document');
        const neededEvidence = profile.account_type === 'agent' ? 'right-to-list' : 'ownership-proof';
        controls.images.required = existingImages.length === 0;
        controls.document.required = !documents?.some((document) => document.document_type === neededEvidence);
        controls.location_document.required = !documents?.some((document) => ['survey-plan', 'address-proof'].includes(document.document_type));
        controls.document_type.value = neededEvidence;
        document.querySelector('#listing-form-title').textContent = property.status === 'rejected' ? 'Update and resubmit' : 'Complete your listing';
        document.querySelector('#listing-panel > p').textContent = property.status === 'rejected'
            ? 'This rejected listing will return to pending review when resubmitted. Existing photos and evidence remain attached.'
            : 'This listing is not public yet. Complete missing details or files and submit it for review.';
        listingPanel.hidden = false;
        profilePanel.hidden = true;
        listingPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        showMessage(dashboardMessage, error.message, 'error');
    }
}

listingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = listingForm.querySelector('[type="submit"]');
    const imageFiles = [...listingForm.elements.images.files];
    const documentFile = listingForm.elements.document.files[0];
    const locationDocumentFile = listingForm.elements.location_document.files[0];
    if (imageFiles.length + existingImages.length > 10 || imageFiles.some((file) => file.size > 10 * 1024 * 1024)) {
        showMessage(listingError, 'Choose no more than 10 images, each at most 10 MB.', 'error');
        return;
    }
    if (!editingPropertyId && !imageFiles.length) {
        showMessage(listingError, 'Choose at least one property photo.', 'error');
        return;
    }
    if ([documentFile, locationDocumentFile].some((file) => file && file.size > 15 * 1024 * 1024)) {
        showMessage(listingError, 'Each evidence file must be 15 MB or smaller.', 'error');
        return;
    }

    button.disabled = true;
    showMessage(listingError, 'Saving the listing and uploading private files…');
    const controls = listingForm.elements;
    const values = {
        title: controls.title.value.trim(),
        description: controls.description.value.trim(),
        property_type: controls.property_type.value,
        purpose: controls.purpose.value,
        price: Number(controls.price.value),
        state: controls.state.value.trim(),
        city: controls.city.value.trim(),
        area: controls.area.value.trim() || null,
        bedrooms: controls.bedrooms.value === '' ? null : Number(controls.bedrooms.value),
        bathrooms: controls.bathrooms.value === '' ? null : Number(controls.bathrooms.value),
        size_sqm: controls.size_sqm.value === '' ? null : Number(controls.size_sqm.value),
        amenities: controls.amenities.value.split(',').map((amenity) => amenity.trim()).filter(Boolean).slice(0, 40)
    };
    const documents = [
        documentFile ? { file: documentFile, type: controls.document_type.value } : null,
        locationDocumentFile ? { file: locationDocumentFile, type: controls.location_document_type.value } : null
    ].filter(Boolean);

    try {
        const property = await submitProperty({
            values,
            images: imageFiles,
            documents,
            address: controls.address.value.trim(),
            propertyId: editingPropertyId
        });
        listingPanel.hidden = true;
        clearListingForm();
        showMessage(dashboardMessage, `Listing ${property.id} was submitted for review. It will not appear publicly until approved.`, 'success');
        try {
            await refreshListings();
        } catch (refreshError) {
            showMessage(dashboardMessage, `Listing ${property.id} was submitted for review, but the table could not refresh: ${refreshError.message}`, 'error');
        }
    } catch (error) {
        if (error.propertyId) {
            editingPropertyId = error.propertyId;
            try { await refreshListings(); } catch { /* Keep the form open for retry. */ }
        }
        showMessage(listingError, error.message, 'error');
    } finally {
        button.disabled = false;
    }
});

document.querySelector('#new-listing').addEventListener('click', () => {
    if (!['owner', 'agent'].includes(profile?.account_type)) {
        showMessage(dashboardMessage, 'Property submissions are available to property owners and real estate agents. Update your profile account type with support if this is incorrect.', 'error');
        return;
    }
    openNewListing();
});
document.querySelector('#cancel-listing').addEventListener('click', () => { listingPanel.hidden = true; clearListingForm(); });
document.querySelector('#edit-profile').addEventListener('click', () => {
    profilePanel.hidden = false;
    listingPanel.hidden = true;
    profileForm.elements.display_name.value = profile.display_name ?? '';
    profileForm.elements.phone.value = profile.phone ?? '';
    profileForm.elements.allow_public_contact.checked = profile.allow_public_contact;
    profilePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.querySelector('#cancel-profile').addEventListener('click', () => { profilePanel.hidden = true; });
profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = profileForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
        const { error } = await supabase.from('profiles').update({
            display_name: profileForm.elements.display_name.value.trim(),
            phone: profileForm.elements.phone.value.trim(),
            allow_public_contact: profileForm.elements.allow_public_contact.checked
        }).eq('id', currentUser.id);
        if (error) throw error;
        profile = {
            ...profile,
            display_name: profileForm.elements.display_name.value.trim(),
            phone: profileForm.elements.phone.value.trim(),
            allow_public_contact: profileForm.elements.allow_public_contact.checked
        };
        profilePanel.hidden = true;
        showMessage(dashboardMessage, 'Profile updated.', 'success');
    } catch (error) {
        showMessage(dashboardMessage, error.message, 'error');
    } finally {
        button.disabled = false;
    }
});
document.querySelector('#sign-out').addEventListener('click', async () => {
    try { await signOut(); } catch (error) { showMessage(dashboardMessage, error.message, 'error'); return; }
    window.location.assign('account.html');
});

async function initialize() {
    try {
        const current = await getCurrentUser();
        supabase = current.supabase;
        currentUser = current.user;
        if (!currentUser) {
            window.location.replace('account.html#login');
            return;
        }
        const { data, error } = await supabase.from('profiles').select('id, display_name, phone, allow_public_contact, account_type, is_suspended').eq('id', currentUser.id).single();
        if (error) throw error;
        profile = data;
        if (profile.is_suspended) {
            showMessage(dashboardMessage, 'This account is suspended. Contact Aurevia support for assistance.', 'error');
            document.querySelector('#new-listing').disabled = true;
            return;
        }
        if (!['owner', 'agent'].includes(profile.account_type)) {
            document.querySelector('#new-listing').hidden = true;
            showMessage(dashboardMessage, 'Your account is set up for browsing. Property submission is available to owners and agents.', 'info');
        } else if (!profile.phone) {
            showMessage(dashboardMessage, 'Add a contact phone in your profile before submitting a listing.', 'info');
        }
        if (profile.account_type === 'agent') {
            listingForm.elements.document_type.value = 'right-to-list';
        }
        await refreshListings();
    } catch (error) {
        renderListings([]);
        showMessage(dashboardMessage, error.message, 'error');
    }
}

await initialize();
