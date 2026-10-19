create extension if not exists pgcrypto;

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null default '',
    phone text,
    allow_public_contact boolean not null default false,
    account_type text not null default 'buyer'
        check (account_type in ('buyer', 'renter', 'owner', 'agent')),
    is_suspended boolean not null default false,
    suspension_reason text,
    created_at timestamptz not null default now()
);

create table public.admin_users (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

create table public.properties (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references public.profiles(id) on delete restrict,
    title text not null check (char_length(title) between 8 and 140),
    description text not null check (char_length(description) between 30 and 6000),
    property_type text not null check (property_type in ('house', 'apartment', 'land', 'commercial', 'other')),
    purpose text not null check (purpose in ('sale', 'rent', 'short-let')),
    price numeric(16, 2) not null check (price > 0),
    currency text not null default 'NGN' check (currency in ('NGN', 'USD', 'GBP')),
    state text not null check (char_length(state) between 2 and 100),
    city text not null check (char_length(city) between 2 and 100),
    area text,
    bedrooms smallint check (bedrooms between 0 and 100),
    bathrooms smallint check (bathrooms between 0 and 100),
    size_sqm numeric(12, 2) check (size_sqm > 0),
    amenities text[] not null default '{}',
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.property_review_records (
    property_id uuid primary key references public.properties(id) on delete cascade,
    rejection_reason text,
    reviewed_by uuid references auth.users(id) on delete set null,
    reviewed_at timestamptz not null default now()
);

create table public.property_private_details (
    property_id uuid primary key references public.properties(id) on delete cascade,
    full_address text not null check (char_length(full_address) between 8 and 300),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.property_images (
    id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade,
    object_path text not null unique,
    alt_text text not null default '',
    sort_order smallint not null default 0 check (sort_order >= 0),
    created_at timestamptz not null default now()
);

create table public.property_verification_documents (
    id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade,
    object_path text not null unique,
    document_type text not null check (document_type in ('ownership-proof', 'right-to-list', 'survey-plan', 'address-proof', 'other')),
    created_at timestamptz not null default now()
);

create index properties_public_search_idx
    on public.properties (purpose, property_type, price, state, city)
    where status = 'approved';
create index properties_owner_status_idx
    on public.properties (owner_id, status, created_at desc);
create index property_images_property_order_idx
    on public.property_images (property_id, sort_order);

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

    insert into public.profiles (id, display_name, phone, account_type)
    values (
        new.id,
        coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), ''),
        nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
        requested_type
    );
    return new;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.admin_users a where a.user_id = (select auth.uid())
    );
$$;

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
    );
$$;

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
              or (p.status = 'approved' and not coalesce(owner_profile.is_suspended, true))
          )
    );
$$;

create or replace function public.can_manage_property(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.properties p
        where p.id = target_property_id
          and (public.is_admin() or p.owner_id = (select auth.uid()))
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
    );
$$;

create or replace function public.storage_property_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
    return split_part(object_name, '/', 1)::uuid;
exception when invalid_text_representation then
    return null;
end;
$$;

create or replace function public.can_read_property_image(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.property_images i
        where i.object_path = object_name
          and public.can_access_property(i.property_id)
    );
$$;

create or replace function public.can_read_verification_document(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.property_verification_documents d
        where d.object_path = object_name
          and public.can_manage_property(d.property_id)
    );
$$;

create or replace function public.set_property_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
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
            raise exception 'An active owner or agent with a contact phone is required to submit a listing';
        end if;
        new.owner_id := auth.uid();
        new.status := 'pending';
        return new;
    end if;

    if not public.is_admin() then
        if old.owner_id <> auth.uid() or old.status not in ('pending', 'rejected') then
            raise exception 'This listing cannot be edited';
        end if;
        new.owner_id := old.owner_id;
        new.status := 'pending';
    end if;
    return new;
end;
$$;

create or replace function public.guard_property_image_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    target_property_id uuid;
    property_owner_id uuid;
    image_count bigint;
begin
    target_property_id := case when tg_op = 'DELETE' then old.property_id else new.property_id end;
    if not public.is_admin() and not public.can_edit_property(target_property_id) then
        raise exception 'Only the listing owner may manage images while a listing is pending or rejected';
    end if;

    if tg_op <> 'DELETE' then
        select p.owner_id into property_owner_id from public.properties p where p.id = new.property_id;
        if property_owner_id is null
            or split_part(new.object_path, '/', 1) <> new.property_id::text then
            raise exception 'Image path must be <property-id>/<filename>';
        end if;
        select count(*) into image_count from public.property_images i
        where i.property_id = new.property_id and i.id <> new.id;
        if image_count >= 10 then
            raise exception 'A listing can have at most 10 images';
        end if;
        return new;
    end if;
    return old;
end;
$$;

create or replace function public.guard_verification_document_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    target_property_id uuid;
    property_owner_id uuid;
    document_count bigint;
begin
    target_property_id := case when tg_op = 'DELETE' then old.property_id else new.property_id end;
    if not public.is_admin() and not public.can_edit_property(target_property_id) then
        raise exception 'Only the listing owner may manage evidence while a listing is pending or rejected';
    end if;

    if tg_op <> 'DELETE' then
        select p.owner_id into property_owner_id from public.properties p where p.id = new.property_id;
        if property_owner_id is null
            or split_part(new.object_path, '/', 1) <> new.property_id::text then
            raise exception 'Document path must be <property-id>/<filename>';
        end if;
        select count(*) into document_count from public.property_verification_documents d
        where d.property_id = new.property_id and d.id <> new.id;
        if document_count >= 10 then
            raise exception 'A listing can have at most 10 verification documents';
        end if;
        return new;
    end if;
    return old;
end;
$$;

create or replace function public.create_private_property_details(target_property_id uuid, submitted_address text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.can_edit_property(target_property_id) then
        raise exception 'Only the listing owner may add a private address to an editable listing';
    end if;
    insert into public.property_private_details (property_id, full_address)
    values (target_property_id, trim(submitted_address))
    on conflict (property_id) do update
        set full_address = excluded.full_address, updated_at = now();
end;
$$;

create or replace function public.review_property(target_property_id uuid, decision text, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_admin() then
        raise exception 'Administrator access required' using errcode = '42501';
    end if;
    if decision not in ('approved', 'rejected') then
        raise exception 'Decision must be approved or rejected';
    end if;
    if decision = 'rejected' and char_length(trim(coalesce(reason, ''))) < 10 then
        raise exception 'A rejection reason of at least 10 characters is required';
    end if;
    if decision = 'approved' and not exists (
        select 1
        from public.properties p
        join public.profiles owner_profile on owner_profile.id = p.owner_id
        where p.id = target_property_id
          and nullif(trim(coalesce(owner_profile.phone, '')), '') is not null
          and exists (
              select 1 from public.property_private_details d
              where d.property_id = p.id and char_length(trim(d.full_address)) >= 8
          )
          and exists (select 1 from public.property_images i where i.property_id = p.id)
          and exists (
              select 1 from public.property_verification_documents v
              where v.property_id = p.id
                and v.document_type = case owner_profile.account_type
                    when 'agent' then 'right-to-list'
                    else 'ownership-proof'
                end
          )
                    and exists (
                            select 1 from public.property_verification_documents v
                            where v.property_id = p.id
                                and v.document_type in ('survey-plan', 'address-proof')
                    )
    ) then
                raise exception 'Approval requires contact details, private address, an image, ownership or authority proof, and separate survey/address evidence';
    end if;

    update public.properties
    set status = decision, updated_at = now()
    where id = target_property_id
      and owner_id <> (select auth.uid())
      and status <> decision;
    if not found then
        raise exception 'Listing not found, owned by this administrator, or already has this status';
    end if;

    insert into public.property_review_records (property_id, rejection_reason, reviewed_by, reviewed_at)
    values (
        target_property_id,
        case when decision = 'rejected' then trim(reason) else null end,
        (select auth.uid()),
        now()
    )
    on conflict (property_id) do update
    set rejection_reason = excluded.rejection_reason,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at;
end;
$$;

create or replace function public.set_user_suspension(target_user_id uuid, suspend_account boolean, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_admin() then
        raise exception 'Administrator access required' using errcode = '42501';
    end if;
    if target_user_id = (select auth.uid()) then
        raise exception 'Administrators cannot suspend themselves';
    end if;
    if exists (select 1 from public.admin_users a where a.user_id = target_user_id) then
        raise exception 'Administrator accounts cannot be suspended here';
    end if;
    update public.profiles
    set is_suspended = suspend_account,
        suspension_reason = case when suspend_account then nullif(trim(reason), '') else null end
    where id = target_user_id;
    if not found then
        raise exception 'User not found';
    end if;
end;
$$;

create or replace function public.admin_property_counts()
returns table (total_properties bigint, pending_properties bigint, approved_properties bigint, rejected_properties bigint, total_users bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.is_admin() then
        raise exception 'Administrator access required' using errcode = '42501';
    end if;
    return query select
        (select count(*) from public.properties),
        (select count(*) from public.properties where status = 'pending'),
        (select count(*) from public.properties where status = 'approved'),
        (select count(*) from public.properties where status = 'rejected'),
        (select count(*) from public.profiles);
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
    select p.id, u.email::text, p.display_name, p.account_type, p.is_suspended, p.suspension_reason, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

create or replace function public.my_properties()
returns table (
    id uuid, title text, description text, property_type text, purpose text,
    price numeric, currency text, state text, city text, area text,
    bedrooms smallint, bathrooms smallint, size_sqm numeric, amenities text[],
    status text, rejection_reason text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Sign in to view your listings' using errcode = '42501';
    end if;
    return query
    select p.id, p.title, p.description, p.property_type, p.purpose,
        p.price, p.currency, p.state, p.city, p.area, p.bedrooms,
        p.bathrooms, p.size_sqm, p.amenities, p.status,
        r.rejection_reason, p.created_at
    from public.properties p
    left join public.property_review_records r on r.property_id = p.id
    where p.owner_id = (select auth.uid())
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
            'display_name', pr.display_name, 'account_type', pr.account_type,
            'phone', pr.phone, 'email', au.email
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

create or replace function public.search_properties(
    search_term text default null,
    purpose_filter text default null,
    type_filter text default null,
    minimum_price numeric default null,
    maximum_price numeric default null,
    result_limit integer default 24,
    result_offset integer default 0
)
returns table (id uuid, title text, description text, property_type text, purpose text, price numeric, currency text, state text, city text, area text, bedrooms smallint, bathrooms smallint, size_sqm numeric, amenities text[], created_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
    select p.id, p.title, p.description, p.property_type, p.purpose, p.price, p.currency,
        p.state, p.city, p.area, p.bedrooms, p.bathrooms, p.size_sqm, p.amenities, p.created_at
    from public.properties p
    where p.status = 'approved'
      and public.can_access_property(p.id)
      and (purpose_filter is null or p.purpose = purpose_filter)
      and (type_filter is null or p.property_type = type_filter)
      and (minimum_price is null or p.price >= minimum_price)
      and (maximum_price is null or p.price <= maximum_price)
      and (
          nullif(trim(search_term), '') is null
          or concat_ws(' ', p.state, p.city, p.area) ilike '%' || trim(search_term) || '%'
      )
    order by p.created_at desc
    limit greatest(1, least(coalesce(result_limit, 24), 60))
    offset greatest(coalesce(result_offset, 0), 0);
$$;

create or replace function public.public_property_contact(target_property_id uuid)
returns table (display_name text, phone text)
language sql
stable
security definer
set search_path = ''
as $$
        select p.display_name, p.phone
        from public.properties listing
        join public.profiles p on p.id = listing.owner_id
        where listing.id = target_property_id
            and listing.status = 'approved'
            and not p.is_suspended
            and p.allow_public_contact;
$$;

create trigger auth_user_profile_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
create trigger properties_updated_at
    before update on public.properties
    for each row execute function public.set_property_updated_at();
create trigger properties_submission_guard
    before insert or update on public.properties
    for each row execute function public.enforce_property_submission();
create trigger property_images_guard
    before insert or update or delete on public.property_images
    for each row execute function public.guard_property_image_write();
create trigger property_verification_documents_guard
    before insert or delete on public.property_verification_documents
    for each row execute function public.guard_verification_document_write();

alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.properties enable row level security;
alter table public.property_review_records enable row level security;
alter table public.property_private_details enable row level security;
alter table public.property_images enable row level security;
alter table public.property_verification_documents enable row level security;

revoke all on public.profiles, public.admin_users, public.properties,
    public.property_review_records, public.property_private_details, public.property_images,
    public.property_verification_documents from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, phone, allow_public_contact) on public.profiles to authenticated;
grant select (id, title, description, property_type, purpose, price, currency, state, city, area, bedrooms, bathrooms, size_sqm, amenities, status, created_at, updated_at)
    on public.properties to anon, authenticated;
grant insert (title, description, property_type, purpose, price, currency, state, city, area, bedrooms, bathrooms, size_sqm, amenities)
    on public.properties to authenticated;
grant update (title, description, property_type, purpose, price, currency, state, city, area, bedrooms, bathrooms, size_sqm, amenities)
    on public.properties to authenticated;
grant select on public.property_images to anon, authenticated;
grant insert, update, delete on public.property_images to authenticated;
grant select, insert, delete on public.property_verification_documents to authenticated;
grant select on public.property_private_details to authenticated;

create policy profiles_read_self_admin on public.profiles
    for select to authenticated
    using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update_self on public.profiles
    for update to authenticated
    using (id = (select auth.uid()) and not is_suspended)
    with check (id = (select auth.uid()));
create policy admin_users_read_admin on public.admin_users
    for select to authenticated
    using ((select public.is_admin()));

create policy properties_read_authorized on public.properties
    for select to anon, authenticated
    using (public.can_access_property(id));
create policy properties_insert_owner_pending on public.properties
    for insert to authenticated
    with check (owner_id = (select auth.uid()) and status = 'pending' and (select public.can_submit_listings()));
create policy properties_update_owner_unpublished on public.properties
    for update to authenticated
    using (owner_id = (select auth.uid()) and status in ('pending', 'rejected') and (select public.can_submit_listings()))
    with check (owner_id = (select auth.uid()) and status in ('pending', 'rejected') and (select public.can_submit_listings()));

create policy private_details_read_owner_admin on public.property_private_details
    for select to authenticated
    using (public.can_manage_property(property_id));
create policy property_images_read_authorized on public.property_images
    for select to anon, authenticated
    using (public.can_access_property(property_id));
create policy property_images_insert_owner on public.property_images
    for insert to authenticated
    with check (public.can_edit_property(property_id));
create policy property_images_update_owner on public.property_images
    for update to authenticated
    using (public.can_edit_property(property_id))
    with check (public.can_edit_property(property_id));
create policy property_images_delete_owner on public.property_images
    for delete to authenticated
    using (public.can_edit_property(property_id));

create policy verification_documents_read_owner_admin on public.property_verification_documents
    for select to authenticated
    using (public.can_manage_property(property_id));
create policy verification_documents_insert_owner on public.property_verification_documents
    for insert to authenticated
    with check (public.can_edit_property(property_id));
create policy verification_documents_delete_owner on public.property_verification_documents
    for delete to authenticated
    using (public.can_edit_property(property_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    ('property-images', 'property-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
    ('verification-documents', 'verification-documents', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy property_images_storage_read_authorized on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'property-images' and public.can_read_property_image(name));
create policy property_images_storage_insert_owner on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'property-images'
        and public.can_edit_property(public.storage_property_id(name))
    );
create policy property_images_storage_delete_owner on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'property-images'
        and public.can_edit_property(public.storage_property_id(name))
    );
create policy property_documents_storage_read_owner_admin on storage.objects
    for select to authenticated
    using (bucket_id = 'verification-documents' and public.can_read_verification_document(name));
create policy property_documents_storage_insert_owner on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'verification-documents'
        and public.can_edit_property(public.storage_property_id(name))
    );
create policy property_documents_storage_delete_owner on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'verification-documents'
        and public.can_edit_property(public.storage_property_id(name))
    );

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to anon, authenticated;
revoke all on function public.can_submit_listings() from public, anon;
grant execute on function public.can_submit_listings() to authenticated;
revoke all on function public.can_access_property(uuid) from public;
grant execute on function public.can_access_property(uuid) to anon, authenticated;
revoke all on function public.can_manage_property(uuid) from public, anon;
grant execute on function public.can_manage_property(uuid) to authenticated;
revoke all on function public.can_edit_property(uuid) from public, anon;
grant execute on function public.can_edit_property(uuid) to authenticated;
revoke all on function public.storage_property_id(text) from public;
grant execute on function public.storage_property_id(text) to anon, authenticated;
revoke all on function public.can_read_property_image(text) from public;
grant execute on function public.can_read_property_image(text) to anon, authenticated;
revoke all on function public.can_read_verification_document(text) from public, anon;
grant execute on function public.can_read_verification_document(text) to authenticated;
revoke all on function public.create_private_property_details(uuid, text) from public, anon;
grant execute on function public.create_private_property_details(uuid, text) to authenticated;
revoke all on function public.review_property(uuid, text, text) from public, anon;
grant execute on function public.review_property(uuid, text, text) to authenticated;
revoke all on function public.set_user_suspension(uuid, boolean, text) from public, anon;
grant execute on function public.set_user_suspension(uuid, boolean, text) to authenticated;
revoke all on function public.admin_property_counts() from public, anon;
grant execute on function public.admin_property_counts() to authenticated;
revoke all on function public.admin_user_directory() from public, anon;
grant execute on function public.admin_user_directory() to authenticated;
revoke all on function public.my_properties() from public, anon;
grant execute on function public.my_properties() to authenticated;
revoke all on function public.admin_review_queue() from public, anon;
grant execute on function public.admin_review_queue() to authenticated;
revoke all on function public.search_properties(text, text, text, numeric, numeric, integer, integer) from public;
grant execute on function public.search_properties(text, text, text, numeric, numeric, integer, integer) to anon, authenticated;
revoke all on function public.public_property_contact(uuid) from public;
grant execute on function public.public_property_contact(uuid) to anon, authenticated;

-- After the chosen administrator has registered, run this once in the Supabase SQL editor:
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'admin@example.com';
