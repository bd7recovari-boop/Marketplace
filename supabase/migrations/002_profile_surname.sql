alter table public.profiles
    add column surname text not null default '';

grant update (surname) on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    requested_type text;
begin
    requested_type := coalesce(new.raw_user_meta_data ->> 'account_type', 'buyer');
    if requested_type not in ('buyer', 'renter', 'owner', 'agent') then
        requested_type := 'buyer';
    end if;

    insert into public.profiles (id, display_name, surname, phone, account_type)
    values (
        new.id,
        coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), ''),
        coalesce(nullif(trim(new.raw_user_meta_data ->> 'surname'), ''), ''),
        nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
        requested_type
    );
    return new;
end;
$$;

create or replace function public.admin_user_directory()
returns table (user_id uuid, email text, display_name text, account_type text, is_suspended boolean, suspension_reason text, created_at timestamptz)
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
    select p.id, u.email::text,
        concat_ws(' ', nullif(trim(p.display_name), ''), nullif(trim(p.surname), '')),
        p.account_type, p.is_suspended, p.suspension_reason, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
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
            'email', au.email
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
      and p.allow_public_contact;
$$;
