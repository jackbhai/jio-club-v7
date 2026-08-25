-- PATCH 7 (idempotent): Branding bucket (public logo storage, admin-only write)
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

drop policy if exists "branding_public_read" on storage.objects;
create policy "branding_public_read" on storage.objects for select
using (bucket_id = 'branding');

drop policy if exists "branding_admin_write" on storage.objects;
create policy "branding_admin_write" on storage.objects for insert
with check (bucket_id = 'branding' and public.is_admin());

drop policy if exists "branding_admin_delete" on storage.objects;
create policy "branding_admin_delete" on storage.objects for delete
using (bucket_id = 'branding' and public.is_admin());

-- extend appearance defaults with branding fields (additive)
update public.settings
set value = value
  || jsonb_build_object('accent2', coalesce(value->>'accent2', '#00c896'),
                        'logoUrl', coalesce(value->>'logoUrl', ''),
                        'logoText', coalesce(value->>'logoText', ''))
where key = 'appearance';
