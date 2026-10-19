import { requireSupabase } from './supabase.js';

export async function getAdminData() {
    const supabase = await requireSupabase();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) throw new Error('Sign in with an administrator account to continue.');

    const { data: isAdmin, error: roleError } = await supabase.rpc('is_admin');
    if (roleError) throw roleError;
    if (!isAdmin) throw new Error('This account does not have administrator access.');

    const [countsResult, propertiesResult, usersResult] = await Promise.all([
        supabase.rpc('admin_property_counts'),
        supabase.rpc('admin_review_queue'),
        supabase.rpc('admin_user_directory')
    ]);
    for (const result of [countsResult, propertiesResult, usersResult]) {
        if (result.error) throw result.error;
    }

    const properties = await Promise.all((propertiesResult.data ?? []).map(async (property) => ({
        ...property,
        address: property.full_address,
        images: await signFiles(supabase, 'property-images', property.images ?? []),
        documents: await signFiles(supabase, 'verification-documents', property.documents ?? [])
    })));
    return {
        supabase,
        user: authData.user,
        counts: countsResult.data?.[0] ?? {},
        properties,
        users: usersResult.data ?? []
    };
}

async function signFiles(supabase, bucket, files) {
    return Promise.all(files.map(async (file) => {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(file.object_path, 600);
        return { ...file, url: error ? '' : data.signedUrl };
    }));
}

export async function reviewProperty(supabase, propertyId, decision, reason = '') {
    const { error } = await supabase.rpc('review_property', {
        target_property_id: propertyId,
        decision,
        reason: reason || null
    });
    if (error) throw error;
}

export async function suspendUser(supabase, userId, reason) {
    const { error } = await supabase.rpc('set_user_suspension', {
        target_user_id: userId,
        suspend_account: true,
        reason
    });
    if (error) throw error;
}

export async function reinstateUser(supabase, userId) {
    const { error } = await supabase.rpc('set_user_suspension', {
        target_user_id: userId,
        suspend_account: false,
        reason: null
    });
    if (error) throw error;
}
