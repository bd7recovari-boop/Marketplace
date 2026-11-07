alter table public.profiles
    add column if not exists seller_verification_status text not null default 'unverified'
        check (seller_verification_status in ('unverified', 'pending', 'verified', 'failed')),
    add column if not exists seller_verification_reference text unique,
    add column if not exists seller_verified_at timestamptz,
    add column if not exists seller_verification_consent_at timestamptz,
    add column if not exists seller_verification_consent_version text;

create or replace function public.can_submit_listings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid())
          and p.account_type in ('owner', 'agent')
          and nullif(trim(coalesce(p.phone, '')), '') is not null
          and not p.is_suspended
          and p.seller_verification_status = 'verified'
    );
$$;

create or replace function public.can_edit_property(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.properties p
        join public.profiles owner_profile on owner_profile.id = p.owner_id
        where p.id = target_property_id
          and p.owner_id = (select auth.uid())
          and p.status in ('pending', 'rejected')
          and owner_profile.account_type in ('owner', 'agent')
          and nullif(trim(coalesce(owner_profile.phone, '')), '') is not null
          and not owner_profile.is_suspended
          and owner_profile.seller_verification_status = 'verified'
    );
$$;

create or replace function public.enforce_property_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        if auth.uid() is null or not public.can_submit_listings() then
            raise exception 'An active, identity-verified owner or agent with a contact phone is required to submit a listing';
        end if;
        new.owner_id := auth.uid();
        new.status := 'pending';
        return new;
    end if;

    if not public.is_admin() then
        if not public.can_submit_listings() then
            raise exception 'An active, identity-verified owner or agent with a contact phone is required to update a listing';
        end if;
        if old.owner_id <> auth.uid() or old.status not in ('pending', 'rejected') then
            raise exception 'This listing cannot be edited';
        end if;
        new.owner_id := old.owner_id;
        new.status := 'pending';
    end if;
    return new;
end;
$$;

create or replace function public.start_seller_identity_verification(consent_confirmed boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    requesting_user uuid := (select auth.uid());
    user_type text;
    user_status text;
    verification_reference text;
begin
    if requesting_user is null then
        raise exception 'Sign in before verifying your identity' using errcode = '42501';
    end if;
    if consent_confirmed is distinct from true then
        raise exception 'Consent is required before identity verification';
    end if;

    select p.account_type, p.seller_verification_status
    into user_type, user_status
    from public.profiles p
    where p.id = requesting_user and not p.is_suspended;

    if not found or user_type not in ('owner', 'agent') then
        raise exception 'Only active owners and agents can verify as sellers' using errcode = '42501';
    end if;
    if user_status = 'verified' then
        raise exception 'Your seller identity is already verified';
    end if;

    verification_reference := 'AUR-' || replace(gen_random_uuid()::text, '-', '');
    update public.profiles
    set seller_verification_status = 'pending',
        seller_verification_reference = verification_reference,
        seller_verified_at = null,
        seller_verification_consent_at = now(),
        seller_verification_consent_version = 'nin-selfie-v1'
    where id = requesting_user;

    return verification_reference;
end;
$$;

create or replace function public.complete_seller_identity_verification(
    target_reference text,
    verification_passed boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.profiles
    set seller_verification_status = case when verification_passed then 'verified' else 'failed' end,
        seller_verified_at = case when verification_passed then now() else null end
    where seller_verification_reference = target_reference
      and seller_verification_status = 'pending'
      and account_type in ('owner', 'agent')
      and not is_suspended;
    return found;
end;
$$;

revoke all on function public.start_seller_identity_verification(boolean) from public, anon;
grant execute on function public.start_seller_identity_verification(boolean) to authenticated;
revoke all on function public.complete_seller_identity_verification(text, boolean) from public, anon, authenticated;
grant execute on function public.complete_seller_identity_verification(text, boolean) to service_role;

revoke all on function public.can_submit_listings() from public, anon;
grant execute on function public.can_submit_listings() to authenticated;
revoke all on function public.can_edit_property(uuid) from public, anon;
grant execute on function public.can_edit_property(uuid) to authenticated;

create or replace function public.can_access_property(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.properties p
        left join public.profiles owner_profile on owner_profile.id = p.owner_id
        where p.id = target_property_id
          and (
              public.is_admin()
              or p.owner_id = (select auth.uid())
              or (
                  p.status = 'approved'
                  and not coalesce(owner_profile.is_suspended, true)
                  and owner_profile.seller_verification_status = 'verified'
              )
          )
    );
$$;

create or replace function public.admin_review_queue()
returns table (
    id uuid, owner_id uuid, title text, description text, property_type text,
    purpose text, price numeric, currency text, state text, city text, area text,
    bedrooms smallint, bathrooms smallint, size_sqm numeric, amenities text[],
    status text, rejection_reason text, created_at timestamptz,
    owner jsonb, full_address text, images jsonb, documents jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.is_admin() then
        raise exception 'Administrator access required' using errcode = '42501';
    end if;
    return query
    select p.id, p.owner_id, p.title, p.description, p.property_type,
        p.purpose, p.price, p.currency, p.state, p.city, p.area,
        p.bedrooms, p.bathrooms, p.size_sqm, p.amenities, p.status,
        r.rejection_reason, p.created_at,
        jsonb_build_object(
            'display_name', concat_ws(' ', nullif(trim(pr.display_name), ''), nullif(trim(pr.surname), '')),
            'account_type', pr.account_type,
            'phone', pr.phone,
            'email', au.email,
            'seller_verification_status', pr.seller_verification_status,
            'seller_verified_at', pr.seller_verified_at
        ),
        details.full_address,
        coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', image.id, 'object_path', image.object_path,
                'alt_text', image.alt_text, 'sort_order', image.sort_order
            ) order by image.sort_order)
            from public.property_images image where image.property_id = p.id
        ), '[]'::jsonb),
        coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', doc.id, 'object_path', doc.object_path,
                'document_type', doc.document_type
            ) order by doc.created_at)
            from public.property_verification_documents doc where doc.property_id = p.id
        ), '[]'::jsonb)
    from public.properties p
    join public.profiles pr on pr.id = p.owner_id
    join auth.users au on au.id = p.owner_id
    left join public.property_private_details details on details.property_id = p.id
    left join public.property_review_records r on r.property_id = p.id
    order by case p.status when 'pending' then 0 when 'rejected' then 1 else 2 end, p.created_at desc;
end;
$$;

create or replace function public.public_property_contact(target_property_id uuid)
returns table (display_name text, phone text)
language sql
stable
security definer
set search_path = ''
as $$
    select concat_ws(' ', nullif(trim(p.display_name), ''), nullif(trim(p.surname), '')), p.phone
    from public.properties listing
    join public.profiles p on p.id = listing.owner_id
    where listing.id = target_property_id
      and listing.status = 'approved'
      and not p.is_suspended
      and p.seller_verification_status = 'verified'
      and p.allow_public_contact;
$$;

revoke all on function public.can_access_property(uuid) from public;
grant execute on function public.can_access_property(uuid) to anon, authenticated;
revoke all on function public.admin_review_queue() from public, anon;
grant execute on function public.admin_review_queue() to authenticated;
revoke all on function public.public_property_contact(uuid) from public;
grant execute on function public.public_property_contact(uuid) to anon, authenticated;