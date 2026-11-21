create table public.property_reports (
    id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade,
    reporter_id uuid not null references auth.users(id) on delete cascade,
    reason text not null check (reason in (
        'suspicious-price',
        'possibly-fake',
        'misleading-information',
        'owner-or-agent-concern',
        'other'
    )),
    details text not null check (char_length(trim(details)) between 20 and 1500),
    status text not null default 'open' check (status in ('open', 'dismissed', 'removed')),
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    resolved_by uuid references auth.users(id) on delete set null,
    resolution_note text not null default '',
    unique (property_id, reporter_id)
);

create index property_reports_status_created_idx
    on public.property_reports (status, created_at desc);

alter table public.property_reports enable row level security;
revoke all on public.property_reports from public, anon, authenticated;

create or replace function public.submit_property_report(
    target_property_id uuid,
    report_reason text,
    report_details text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    new_report_id uuid;
begin
    if (select auth.uid()) is null then
        raise exception 'Sign in to report a listing' using errcode = '42501';
    end if;
    if report_reason not in (
        'suspicious-price',
        'possibly-fake',
        'misleading-information',
        'owner-or-agent-concern',
        'other'
    ) then
        raise exception 'Choose a valid report reason';
    end if;
    if char_length(trim(coalesce(report_details, ''))) not between 20 and 1500 then
        raise exception 'Report details must be between 20 and 1500 characters';
    end if;
    if not exists (
        select 1
        from public.properties p
        join public.profiles owner_profile on owner_profile.id = p.owner_id
        where p.id = target_property_id
          and p.status = 'approved'
          and not owner_profile.is_suspended
    ) then
        raise exception 'This listing is no longer available to report';
    end if;

    insert into public.property_reports (property_id, reporter_id, reason, details)
    values (target_property_id, (select auth.uid()), report_reason, trim(report_details))
    returning id into new_report_id;
    return new_report_id;
end;
$$;

create or replace function public.admin_property_reports()
returns table (
    report_id uuid,
    property_id uuid,
    property_title text,
    city text,
    state text,
    listing_status text,
    reason text,
    details text,
    reporter_email text,
    status text,
    created_at timestamptz,
    resolved_at timestamptz,
    resolution_note text
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
    select r.id, r.property_id, p.title, p.city, p.state, p.status,
        r.reason, r.details, u.email::text, r.status, r.created_at,
        r.resolved_at, r.resolution_note
    from public.property_reports r
    join public.properties p on p.id = r.property_id
    join auth.users u on u.id = r.reporter_id
    order by (r.status = 'open') desc, r.created_at desc;
end;
$$;

create or replace function public.resolve_property_report(
    target_report_id uuid,
    report_resolution text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    report_record public.property_reports%rowtype;
begin
    if not public.is_admin() then
        raise exception 'Administrator access required' using errcode = '42501';
    end if;
    if report_resolution not in ('dismissed', 'removed') then
        raise exception 'Choose a valid report resolution';
    end if;

    select * into report_record
    from public.property_reports
    where id = target_report_id
    for update;
    if not found then
        raise exception 'Report not found';
    end if;
    if report_record.status <> 'open' then
        raise exception 'This report has already been resolved';
    end if;

    if report_resolution = 'removed' then
        perform public.review_property(
            report_record.property_id,
            'rejected',
            'Listing removed after report review'
        );
    end if;

    update public.property_reports
    set status = report_resolution,
        resolved_at = now(),
        resolved_by = (select auth.uid()),
        resolution_note = case report_resolution
            when 'removed' then 'Listing removed from public search after admin review.'
            else 'Report reviewed and dismissed by an administrator.'
        end
    where id = target_report_id;
end;
$$;

revoke all on function public.submit_property_report(uuid, text, text) from public, anon;
grant execute on function public.submit_property_report(uuid, text, text) to authenticated;
revoke all on function public.admin_property_reports() from public, anon;
grant execute on function public.admin_property_reports() to authenticated;
revoke all on function public.resolve_property_report(uuid, text) from public, anon;
grant execute on function public.resolve_property_report(uuid, text) to authenticated;