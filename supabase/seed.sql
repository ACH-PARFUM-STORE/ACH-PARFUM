-- =====================================================================
-- ACH PARFUM — بيانات تجريبية (اختياري)
-- عائلات + نوتات + 6 عطور للتجربة. الأسعار والنوتات تقريبية للتجربة فقط:
-- احذفها أو عدّلها من لوحة المدير قبل الإطلاق.
-- شغّله بعد schema.sql.
-- =====================================================================

insert into public.families (name, sort_order) values
  ('خشبي',1), ('شرقي',2), ('حمضي',3), ('زهري',4), ('حلو',5),
  ('منعش',6), ('عنبري',7), ('فواكهي',8), ('جلدي',9)
on conflict (name) do nothing;

insert into public.notes (name, emoji, sort_order) values
  ('الفانيليا','🍦',1), ('القهوة','☕',2), ('العود','🪵',3), ('الورد','🌹',4),
  ('المسك','🤍',5), ('الخشب','🌲',6), ('الحمضيات','🍋',7), ('النوتات الترابية','🌿',8),
  ('الباتشولي','🌱',9), ('الزعفران','🧡',10), ('العنبر','🟠',11), ('الياسمين','🌼',12),
  ('الفلفل','🌶️',13), ('الكراميل','🍯',14), ('الجلد','👜',15), ('البرتقال','🍊',16),
  ('البرغموت','🍈',17), ('اللافندر','💜',18), ('الصندل','🪵',19), ('الهيل','🫛',20),
  ('القرفة','🍂',21), ('التفاح','🍎',22), ('الأرز','🌳',23), ('التمر','🌴',24),
  ('جوز الهند','🥥',25)
on conflict (name) do nothing;

create or replace function public.seed_perfume_tmp(
  p_name text, p_brand text, p_family text, p_desc text,
  p_top text[], p_heart text[], p_base text[],
  p_base_price int, p_featured boolean default false,
  p_out_conc text default null, p_out_size text default null
) returns void language plpgsql as $$
declare
  v_id bigint;
  n text;
  concs   text[]    := array['ضربة 1','ضربة 3','ضربة 6'];
  mult_c  numeric[] := array[1, 1.5, 2];
  sizes   text[]    := array['10ml','30ml','50ml','100ml'];
  mult_s  numeric[] := array[1, 2.4, 3.6, 6.5];
  i int; j int;
begin
  insert into public.perfumes (name, brand, description, family_id, is_featured)
  values (p_name, p_brand, p_desc, (select id from public.families where name = p_family), p_featured)
  on conflict (name, brand) do update set description = excluded.description
  returning id into v_id;

  foreach n in array p_top   loop
    insert into public.perfume_notes select v_id, id, 'top'   from public.notes where name = n on conflict do nothing;
  end loop;
  foreach n in array p_heart loop
    insert into public.perfume_notes select v_id, id, 'heart' from public.notes where name = n on conflict do nothing;
  end loop;
  foreach n in array p_base  loop
    insert into public.perfume_notes select v_id, id, 'base'  from public.notes where name = n on conflict do nothing;
  end loop;

  for i in 1..3 loop
    for j in 1..4 loop
      insert into public.perfume_options (perfume_id, concentration, size, price, is_available, sort_order)
      values (v_id, concs[i], sizes[j],
              round(p_base_price * mult_c[i] * mult_s[j] / 50) * 50,
              coalesce(not (concs[i] = p_out_conc and sizes[j] = p_out_size), true),
              i * 100 + j)
      on conflict (perfume_id, concentration, size) do nothing;
    end loop;
  end loop;
end $$;

select public.seed_perfume_tmp('Sauvage','Dior','منعش',
  'افتتاحية حمضية منعشة بالبرغموت والفلفل، تستقر على قاعدة دافئة من العنبر والخشب.',
  array['البرغموت','الفلفل'], array['اللافندر'], array['العنبر','الخشب','الفانيليا'], 1500, true);

select public.seed_perfume_tmp('Aventus','Creed','فواكهي',
  'عطر فواكهي دخاني بقوة حضور عالية، يبدأ بالتفاح والبرغموت وينتهي بمسك وخشب.',
  array['التفاح','البرغموت'], array['الباتشولي','الياسمين'], array['المسك','الخشب','النوتات الترابية','الفانيليا'], 2200, true, 'ضربة 6','100ml');

select public.seed_perfume_tmp('Black Opium','Yves Saint Laurent','حلو',
  'مزيج جريء من القهوة والفانيليا مع لمسة زهرية، مناسب للأمسيات.',
  array['البرتقال'], array['القهوة','الياسمين'], array['الفانيليا','الباتشولي','الأرز'], 1700, true);

select public.seed_perfume_tmp('Oud Wood','Tom Ford','خشبي',
  'عود فاخر ممزوج بالخشب والهيل والصندل، دافئ وأنيق.',
  array['الهيل'], array['العود','الخشب'], array['الصندل','العنبر','الفانيليا'], 2600, false, 'ضربة 3','10ml');

select public.seed_perfume_tmp('Baccarat Rouge 540','Maison Francis Kurkdjian','عنبري',
  'عنبري زهري لامع بالزعفران والياسمين، رائحة مميزة جداً.',
  array['الزعفران','الياسمين'], array['العنبر'], array['الأرز','الخشب'], 3000, true);

select public.seed_perfume_tmp('Khamrah','Lattafa','شرقي',
  'شرقي حلو دافئ بالقرفة والتمر والفانيليا والكراميل.',
  array['القرفة','البرغموت'], array['التمر','الكراميل'], array['الفانيليا','العنبر','المسك'], 900, false);

drop function public.seed_perfume_tmp(text,text,text,text,text[],text[],text[],int,boolean,text,text);
