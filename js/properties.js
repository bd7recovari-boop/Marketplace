import { requireSupabase } from './supabase.js';
export async function sanitizePropertyImage(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error(`Could not process ${file.name}. Try another image.`);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
            if (result) resolve(result);
            else reject(new Error(`Could not re-encode ${file.name}. Try another image.`));
        }, 'image/webp', 0.88);
    });
    return blob;
}

export async function searchProperties(filters = {}) {
    const supabase = await requireSupabase();
    const { data, error } = await supabase.rpc('search_properties', {
        search_term: filters.location?.trim() || null,
        purpose_filter: filters.purpose || null,
        type_filter: filters.type || null,
        minimum_price: filters.minPrice || null,
        maximum_price: filters.maxPrice || null,
        result_limit: 24,
        result_offset: 0
    });
    if (error) throw error;
    return data ?? [];
}

export async function getImages(propertyIds) {
    if (!propertyIds.length) return [];
    const supabase = await requireSupabase();
    const { data, error } = await supabase
        .from('property_images')
        .select('id, property_id, object_path, alt_text, sort_order')
        .in('property_id', propertyIds)
        .order('sort_order');
    if (error) throw error;

    return Promise.all((data ?? []).map(async (image) => {
        const { data: signed, error: signedError } = await supabase.storage
            .from('property-images')
            .createSignedUrl(image.object_path, 3600);
        return { ...image, url: signedError ? '' : signed.signedUrl };
    }));
}

export async function submitProperty({ values, images, documents, address, propertyId = null }) {
    const supabase = await requireSupabase();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    const user = userData.user;
    if (!user) throw new Error('Sign in before submitting a property.');

    let property = { id: propertyId };
    if (propertyId) {
        const { data, error } = await supabase
            .from('properties')
            .update({ ...values, currency: 'NGN' })
            .eq('id', propertyId)
            .select('id')
            .single();
        if (error) throw error;
        property = data;
    } else {
        const { data, error } = await supabase
            .from('properties')
            .insert({ ...values, currency: 'NGN' })
            .select('id')
            .single();
        if (error) throw error;
        property = data;
    }

    const uploadRecords = [];
    try {
        const { error: addressError } = await supabase.rpc('create_private_property_details', {
            target_property_id: property.id,
            submitted_address: address
        });
        if (addressError) throw addressError;

        for (const [index, file] of images.entries()) {
            const safeImage = await sanitizePropertyImage(file);
            const path = `${property.id}/${crypto.randomUUID()}.webp`;
            const { error } = await supabase.storage.from('property-images').upload(path, safeImage, {
                contentType: 'image/webp',
                upsert: false
            });
            if (error) throw error;
            uploadRecords.push({ bucket: 'property-images', path });
            const { error: rowError } = await supabase.from('property_images').insert({
                property_id: property.id,
                object_path: path,
                alt_text: `${values.title} image ${index + 1}`,
                sort_order: index
            });
            if (rowError) throw rowError;
        }

        for (const document of documents) {
            const extension = document.file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
            const path = `${property.id}/${crypto.randomUUID()}.${extension}`;
            const { error } = await supabase.storage.from('verification-documents').upload(path, document.file, {
                contentType: document.file.type,
                upsert: false
            });
            if (error) throw error;
            uploadRecords.push({ bucket: 'verification-documents', path });
            const { error: rowError } = await supabase.from('property_verification_documents').insert({
                property_id: property.id,
                object_path: path,
                document_type: document.type
            });
            if (rowError) throw rowError;
        }
    } catch (error) {
        for (const upload of uploadRecords) {
            if (upload.bucket === 'property-images') {
                await supabase.from('property_images').delete().eq('object_path', upload.path);
            } else {
                await supabase.from('property_verification_documents').delete().eq('object_path', upload.path);
            }
            await supabase.storage.from(upload.bucket).remove([upload.path]);
        }
        const submissionError = new Error(`Listing ${property.id} remains unpublished, but an upload step failed. Retry the open form or resume this listing from your dashboard. ${error.message}`);
        submissionError.propertyId = property.id;
        throw submissionError;
    }

    return property;
}
