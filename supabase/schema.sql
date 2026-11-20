-- =====================================================================
-- ACH PARFUM — قاعدة البيانات والأمان (Supabase / PostgreSQL)
-- شغّل هذا الملف كاملاً مرة واحدة من: Supabase → SQL Editor → New query
-- الملف آمن لإعادة التشغيل (idempotent) قدر الإمكان.
-- =====================================================================

-- ---------- الجداول ----------

create table if not exists public.families (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.notes (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  emoji       text,                -- أيقونة بديلة إن لم تُرفع صورة
  image_url   text,                -- صورة النوتة (تظهر داخل الدائرة)
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.perfumes (
  id           bigint generated always as identity primary key,
  name         text not null,
  brand        text not null default '',
  description  text not null default '',
  image_url    text,
  family_id    bigint references public.families(id) on delete set null,
  is_featured  boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (name, brand)
);

-- هرم النوتات: كل نوتة تظهر في طبقة واحدة فقط لكل عطر
create table if not exists public.perfume_notes (
  perfume_id  bigint not null references public.perfumes(id) on delete cascade,
  note_id     bigint not null references public.notes(id)    on delete cascade,
  layer       text   not null check (layer in ('top','heart','base')),
  primary key (perfume_id, note_id)
);

-- كل صف = تركيز + حجم + سعر يدوي + توفر مستقل
create table if not exists public.perfume_options (
  id            bigint generated always as identity primary key,
  perfume_id    bigint not null references public.perfumes(id) on delete cascade,
  concentration text   not null,
  size          text   not null,
  price         numeric(12,2) not null check (price >= 0),
  is_available  boolean not null default true,
  sort_order    int     not null default 0,
  unique (perfume_id, concentration, size)
);

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null default '',
  first_name  text not null default '',
  last_name   text not null default '',
  phone       text not null default '',
  address     text not null default '',
  created_at  timestamptz not null default now()
);

-- المدير الوحيد: صف واحد في هذا الجدول (يُضاف يدوياً من SQL Editor فقط)
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.favorites (
  user_id     uuid   not null references auth.users(id) on delete cascade,
  perfume_id  bigint not null references public.perfumes(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, perfume_id)
);

create table if not exists public.orders (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete set null,  -- null = طلب بدون حساب
  first_name  text not null,
  last_name   text not null,
  address     text not null,
  phone       text not null,
  note        text not null default '',
  status      text not null default 'new'
              check (status in ('new','confirmed','preparing','shipped','completed','cancelled')),
  total       numeric(12,2) not null default 0,
  created_at  timestamptz not null default now()
);

-- نسخة ثابتة من تفاصيل المنتج وقت الطلب (لا تتغير لو تغيّر السعر لاحقاً)
create table if not exists public.order_items (
  id             bigint generated always as identity primary key,
  order_id       bigint not null references public.orders(id) on delete cascade,
  perfume_id     bigint references public.perfumes(id) on delete set null,
  option_id      bigint references public.perfume_options(id) on delete set null,
  perfume_name   text not null,
  brand          text not null default '',
  concentration  text not null,
  size           text not null,
  unit_price     numeric(12,2) not null,
  qty            int not null check (qty between 1 and 20)
);

create index if not exists idx_perfume_notes_note   on public.perfume_notes(note_id);
create index if not exists idx_perfume_options_perf on public.perfume_options(perfume_id);
create index if not exists idx_perfumes_family      on public.perfumes(family_id);
create index if not exists idx_orders_user          on public.orders(user_id);
create index if not exists idx_orders_created       on public.orders(created_at desc);
create index if not exists idx_order_items_order    on public.order_items(order_id);

-- ---------- دوال مساعدة ----------

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_perfumes_touch on public.perfumes;
create trigger trg_perfumes_touch before update on public.perfumes
for each row execute function public.touch_updated_at();

-- إنشاء ملف العميل تلقائياً عند التسجيل
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, phone, address)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name',  ''),
    coalesce(new.raw_user_meta_data->>'phone',      ''),
    coalesce(new.raw_user_meta_data->>'address',    '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- تقديم الطلب (الخادم يعيد حساب الأسعار — لا يُوثق بالمتصفح) ----------

create or replace function public.place_order(
  p_first_name text,
  p_last_name  text,
  p_address    text,
  p_phone      text,
  p_items      jsonb,
  p_note       text default ''
) returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_order_id bigint;
  v_total    numeric(12,2) := 0;
  it         jsonb;
  v_qty      int;
  o          record;
begin
  if btrim(coalesce(p_first_name,'')) = '' or btrim(coalesce(p_last_name,'')) = ''
     or btrim(coalesce(p_address,''))  = '' or btrim(coalesce(p_phone,''))    = '' then
    raise exception 'يرجى إدخال الاسم واللقب والعنوان ورقم الهاتف';
  end if;
  if char_length(p_first_name) > 80 or char_length(p_last_name) > 80
     or char_length(p_address) > 400 or char_length(p_phone) > 30
     or char_length(coalesce(p_note,'')) > 1000 then
    raise exception 'بيانات طويلة أكثر من اللازم';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'السلة فارغة';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'عدد المنتجات في الطلب كبير جداً';
  end if;

  insert into public.orders (user_id, first_name, last_name, address, phone, note, total)
  values (auth.uid(), btrim(p_first_name), btrim(p_last_name), btrim(p_address),
          btrim(p_phone), btrim(coalesce(p_note,'')), 0)
  returning id into v_order_id;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((it->>'qty')::int, 0);
    if v_qty < 1 or v_qty > 20 then
      raise exception 'كمية غير صالحة';
    end if;

    select po.id as option_id, po.perfume_id, po.concentration, po.size, po.price,
           po.is_available, p.name as pname, p.brand as pbrand, p.is_active
      into o
      from public.perfume_options po
      join public.perfumes p on p.id = po.perfume_id
     where po.id = (it->>'option_id')::bigint;

    if not found then
      raise exception 'أحد المنتجات لم يعد موجوداً، حدّث السلة';
    end if;
    if not o.is_active or not o.is_available then
      raise exception 'غير متوفر حالياً: % (% - %)', o.pname, o.concentration, o.size;
    end if;

    insert into public.order_items
      (order_id, perfume_id, option_id, perfume_name, brand, concentration, size, unit_price, qty)
    values
      (v_order_id, o.perfume_id, o.option_id, o.pname, o.pbrand, o.concentration, o.size, o.price, v_qty);

    v_total := v_total + o.price * v_qty;
  end loop;

  update public.orders set total = v_total where id = v_order_id;
  return v_order_id;
end $$;

revoke all on function public.place_order(text,text,text,text,jsonb,text) from public;
grant execute on function public.place_order(text,text,text,text,jsonb,text) to anon, authenticated;

-- ---------- الأمان: Row Level Security ----------

alter table public.families        enable row level security;
alter table public.notes           enable row level security;
alter table public.perfumes        enable row level security;
alter table public.perfume_notes   enable row level security;
alter table public.perfume_options enable row level security;
alter table public.profiles        enable row level security;
alter table public.admins          enable row level security;
alter table public.favorites       enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;

-- العائلات والنوتات: قراءة للجميع، كتابة للمدير فقط
drop policy if exists families_read  on public.families;
drop policy if exists families_write on public.families;
create policy families_read  on public.families for select using (true);
create policy families_write on public.families for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists notes_read  on public.notes;
drop policy if exists notes_write on public.notes;
create policy notes_read  on public.notes for select using (true);
create policy notes_write on public.notes for all
  using (public.is_admin()) with check (public.is_admin());

-- العطور: الزوار يرون المفعّلة فقط، والمدير يرى كل شيء
drop policy if exists perfumes_read  on public.perfumes;
drop policy if exists perfumes_write on public.perfumes;
create policy perfumes_read  on public.perfumes for select
  using (is_active or public.is_admin());
create policy perfumes_write on public.perfumes for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists perfume_notes_read  on public.perfume_notes;
drop policy if exists perfume_notes_write on public.perfume_notes;
create policy perfume_notes_read on public.perfume_notes for select
  using (exists (select 1 from public.perfumes p
                 where p.id = perfume_id and (p.is_active or public.is_admin())));
create policy perfume_notes_write on public.perfume_notes for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists perfume_options_read  on public.perfume_options;
drop policy if exists perfume_options_write on public.perfume_options;
create policy perfume_options_read on public.perfume_options for select
  using (exists (select 1 from public.perfumes p
                 where p.id = perfume_id and (p.is_active or public.is_admin())));
create policy perfume_options_write on public.perfume_options for all
  using (public.is_admin()) with check (public.is_admin());

-- الملف الشخصي: صاحبه أو المدير
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());
create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid());
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- جدول المدراء: يستطيع المستخدم أن يرى صفّه فقط. لا إضافة ولا تعديل من الموقع إطلاقاً.
drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select using (user_id = auth.uid());

-- المفضلة: صاحبها فقط
drop policy if exists favorites_own on public.favorites;
create policy favorites_own on public.favorites for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- الطلبات: لا يوجد INSERT من الموقع (يتم فقط عبر place_order).
drop policy if exists orders_select on public.orders;
drop policy if exists orders_update on public.orders;
drop policy if exists orders_delete on public.orders;
create policy orders_select on public.orders for select
  using (user_id = auth.uid() or public.is_admin());
create policy orders_update on public.orders for update
  using (public.is_admin()) with check (public.is_admin());
create policy orders_delete on public.orders for delete
  using (public.is_admin());

drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select
  using (exists (select 1 from public.orders o
                 where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));

-- ---------- تخزين الصور ----------

insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

drop policy if exists images_read   on storage.objects;
drop policy if exists images_insert on storage.objects;
drop policy if exists images_update on storage.objects;
drop policy if exists images_delete on storage.objects;
create policy images_read   on storage.objects for select
  using (bucket_id = 'images');
create policy images_insert on storage.objects for insert
  with check (bucket_id = 'images' and public.is_admin());
create policy images_update on storage.objects for update
  using (bucket_id = 'images' and public.is_admin());
create policy images_delete on storage.objects for delete
  using (bucket_id = 'images' and public.is_admin());

-- =====================================================================
-- بعد إنشاء حساب المدير من الموقع (admin.html لا يسجّل — سجّل من account.html)
-- شغّل هذا السطر مرة واحدة مع بريدك:
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'YOUR-EMAIL@example.com';
--
-- =====================================================================
