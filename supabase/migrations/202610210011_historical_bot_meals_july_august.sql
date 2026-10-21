do $$
declare
  days jsonb := $data$[
    {"date":"2026-07-20","breakfast":[],"breakfast_note":"조식 미제공","lunch":["백미밥","대파계란국","돈가스&모닝빵","양배추샐러드","깍두기","마카로니샐러드"]},
    {"date":"2026-07-21","breakfast":[],"breakfast_note":"조식 미제공","lunch":["백미밥","콩나물냉국","채소볶음밥 도시락김","다짐육가지볶음","아삭이고추장무침","깍두기"]},
    {"date":"2026-07-22","breakfast":[],"breakfast_note":"조식 미제공","lunch":["흑미밥","오이냉국","제육볶음","미역줄기볶음","양배추찜&쌈장","배추김치"]},
    {"date":"2026-07-23","breakfast":[],"breakfast_note":"조식 미제공","lunch":["백미밥","우동/새우튀김 유부초밥","청포묵무침","석박지","야쿠르트"]},
    {"date":"2026-07-24","breakfast":[],"breakfast_note":"조식 미제공","lunch":[],"lunch_note":"금요 에코 휴무"},
    {"date":"2026-08-04","breakfast":[],"breakfast_note":"조식 미제공","lunch":["흑미밥","오이지냉국","닭볶음탕","볼어묵볶음","미역초무침","깍두기"]},
    {"date":"2026-08-05","breakfast":[],"breakfast_note":"조식 미제공","lunch":["잡곡밥","김치콩나물국","생선가스","꽈리고추멸치볶음","가지무침","석박지","양배추샐러드"]},
    {"date":"2026-08-06","breakfast":[],"breakfast_note":"조식 미제공","lunch":["백미밥","유부된장국","비빔밥&계란후라이","열무김치"]},
    {"date":"2026-08-07","breakfast":[],"breakfast_note":"조식 미제공","lunch":[],"lunch_note":"금요 에코 휴무"},
    {"date":"2026-08-11","breakfast":[],"breakfast_note":"조식 미제공","lunch":["백미밥","오이미역냉국","제육볶음","청경채가지볶음","양파장아찌","배추김치"]},
    {"date":"2026-08-12","breakfast":[],"breakfast_note":"조식 미제공","lunch":["흑미밥","맑은감자국","고추잡채","애호박볶음","깻잎간장절임","석박지","옥수수냉차"]},
    {"date":"2026-08-13","breakfast":[],"breakfast_note":"조식 미제공","lunch":["백미밥","도토리묵사발","표고버섯어묵볶음","고사리무침","배추김치","찐옥수수"]},
    {"date":"2026-08-14","breakfast":[],"breakfast_note":"조식 미제공","lunch":[],"lunch_note":"금요 에코 휴무"},
    {"date":"2026-08-19","breakfast":[],"breakfast_note":"조식 미제공","lunch":["백미밥","밀(잔치)국수","七夕(칠석)","야채튀김&간장","배추김치","요거트"]},
    {"date":"2026-08-20","breakfast":[],"breakfast_note":"조식 미제공","lunch":["흑미밥","오이미역냉국","안동찜닭","꽈리고추감자볶음","도라지양파무침","깍두기"]},
    {"date":"2026-08-21","breakfast":[],"breakfast_note":"조식 미제공","lunch":[],"lunch_note":"금요 에코 휴무"},
    {"date":"2026-08-25","breakfast":[],"breakfast_note":"조식 미제공","lunch":["흑미밥","콩나물국","김치볶음밥/도시락김","애호박새우젓볶음","나박물김치","배추김치","양배추샐러드"]},
    {"date":"2026-08-26","breakfast":[],"breakfast_note":"조식 미제공","lunch":["백미밥","미역국","제육볶음","고구마순볶음","흰목이버섯 겨자무침","배추김치"]},
    {"date":"2026-08-27","breakfast":[],"breakfast_note":"조식 미제공","lunch":["백미밥","두부된장국","열무비빔밥 (계란후라이)","콩나물무침","배추김치","푸실리샐러드"]},
    {"date":"2026-08-28","breakfast":[],"breakfast_note":"조식 미제공","lunch":["흑미밥","김치찌개","표고버섯계란찜","들깨가지볶음","오이소박이","배추김치"]},
    {"date":"2026-08-31","breakfast":["[천원의 아침밥] 운영시간 8:00~9:00"],"lunch":["백미밥","얼갈이된장국","닭볶음탕","미역줄기볶음","청포묵김 무침","배추김치"]},
    {"date":"2026-09-01","breakfast":["백미밥","콩나물국","카레라이스","새송이버섯볶음/깍두기","요거트/바나나"],"lunch":["흑미밥","무어묵국","국물떡볶이","만두&김말이튀김","청경채무침","석박지","삶은계란"]}
  ]$data$::jsonb;
  day_entry jsonb;
  meal_kind public.meal_type;
  item_list jsonb;
  note_text text;
  target_meal_id bigint;
  target_food_id bigint;
  menu_name text;
  item_order integer;
begin
  for day_entry in select value from jsonb_array_elements(days) loop
    foreach meal_kind in array array['breakfast'::public.meal_type, 'lunch'::public.meal_type] loop
      item_list := coalesce(day_entry -> meal_kind::text, '[]'::jsonb);
      note_text := nullif(day_entry ->> (meal_kind::text || '_note'), '');

      insert into public.meals (
        meal_date, meal_type, source_type, source_url, is_manual_override,
        is_operating, is_published, admin_note
      ) values (
        (day_entry ->> 'date')::date, meal_kind, 'manual', 'discord://babfull-bot-history', true,
        jsonb_array_length(item_list) > 0, true, note_text
      )
      on conflict (meal_date, meal_type) do update set
        source_type = excluded.source_type,
        source_url = excluded.source_url,
        is_manual_override = true,
        is_operating = excluded.is_operating,
        is_published = true,
        admin_note = excluded.admin_note,
        updated_at = now()
      returning id into target_meal_id;

      delete from public.meal_items where meal_id = target_meal_id;
      item_order := 0;
      for menu_name in select trim(value #>> '{}') from jsonb_array_elements(item_list) loop
        if menu_name = '' or menu_name in ('*', '*`') then continue; end if;
        insert into public.foods (original_name, normalized_name)
        values (menu_name, public.normalize_food_name(menu_name))
        on conflict (normalized_name) do nothing;
        select id into target_food_id
        from public.foods where normalized_name = public.normalize_food_name(menu_name);
        insert into public.meal_items (meal_id, food_id, original_menu_text, display_order)
        values (target_meal_id, target_food_id, menu_name, item_order);
        item_order := item_order + 1;
      end loop;

      insert into public.meal_change_logs (meal_id, previous_data, new_data, change_source)
      values (target_meal_id, null, day_entry || jsonb_build_object('meal_type', meal_kind), 'bot-history-import');
    end loop;
  end loop;
end;
$$;
