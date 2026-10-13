#!/usr/bin/env python3
"""Bygger scripts/kp/odoo-import-apv.sql ur Odoo-exporten (CSV från odoo-export*.sh). Användning: odoo-build-import.py <katalog med csv>"""
import csv, html, json, re, sys
D = sys.argv[1] if len(sys.argv) > 1 else '/tmp/odoo'
rd = lambda f: list(csv.DictReader(open(f'{D}/{f}.csv', encoding='utf-8')))
cats = {c['id']: c for c in rd('categories')}
slides = [s for s in rd('slides') if s['channel_id'] == '1']
sq, sa, fq, fa = rd('slide_questions'), rd('slide_answers'), rd('questions'), rd('answers')
q = lambda s: "'" + s.replace("'", "''") + "'"
def tr(v):
    try: d = json.loads(v); return d.get('sv_SE') or d.get('en_US') or ''
    except Exception: return v
def md(h):
    h = re.sub(r'<br\s*/?>', '\n', tr(h)); out = []; depth = 0; buf = ''; ind = ''
    def flush():
        nonlocal buf, ind
        t = html.unescape(re.sub(r'\s+', ' ', buf)).strip()
        if t: out.append(ind + t)
        buf = ''; ind = ''
    for t in re.split(r'(<[^>]+>)', h):
        if not t.startswith('<'): buf += t; continue
        m = re.match(r'</?([a-z0-9]+)', t); n = m.group(1) if m else ''; close = t.startswith('</')
        if n in ('strong', 'b'): buf += '**'
        elif n in ('em', 'i'): buf += '*'
        elif n == 'li' and not close: flush(); ind = '  ' * (max(depth, 1) - 1); buf = '- '
        elif n == 'li': flush()
        elif n in ('ul', 'ol'):
            flush(); depth += -1 if close else 1
            if close and depth <= 0: out.append(''); depth = 0
        elif n.startswith('h') and len(n) == 2 and not close: flush(); buf = '### '
        elif n in ('p', 'div', 'h1', 'h2', 'h3', 'h4') and close or n in ('p', 'div') and not close: flush(); out.append('')
    flush()
    return re.sub(r'\n{3,}', '\n\n', re.sub(r'\*\*\s*\*\*', '', '\n'.join(out))).strip()
mods = {}
for s in slides:
    if s['category_id'] in cats and s['slide_category'] in ('article', 'video', 'quiz'): mods.setdefault(s['category_id'], []).append(s)
order = sorted(mods, key=lambda c: int(cats[c]['sequence'] or 0))
L = ["-- Importerar APV 1.1–1.3 ur Odoo-exporten (texter, diagnostiska prov, slutprov) som UTKAST. Ersätter ett tidigare utkast (APV-113).",
     "-- Ej importerat: de 11 dokumentavsnitten (saknar filer i Odoo) samt pris/produkt. Videon (scen 1.mp4) laddades upp separat och kopplades till lektionen – kör om detta skript raderar den kopplingen. Genererad av odoo-build-import.py.",
     "begin;", "do $$", "declare v_org uuid := '38fe702d-e72c-49a2-9750-5e0b6934959b'; v_course uuid; v_ver uuid; v_mod uuid; v_les uuid; v_q uuid; v_exam uuid;", "begin",
     "  if exists (select 1 from public.vihem_kp_courses c where c.organisation_id = v_org and c.code = 'APV-113' and c.status <> 'draft') then raise exception 'APV-113 är inte ett utkast – avbryter'; end if;",
     "  delete from public.vihem_kp_exam_questions where exam_id in (select e.id from public.vihem_kp_exams e join public.vihem_kp_course_versions v on v.id = e.version_id join public.vihem_kp_courses c on c.id = v.course_id where c.code = 'APV-113' and c.organisation_id = v_org);",
     "  delete from public.vihem_kp_courses where organisation_id = v_org and code = 'APV-113';",
     "  delete from public.vihem_kp_questions where organisation_id = v_org and 'odoo-apv' = any(tags);",
     "  insert into public.vihem_kp_courses (organisation_id, code, slug, title, subtitle, summary, description, category, delivery_form, estimated_minutes, status, tags, seo_title, objectives, exam_info)",
     "    values (v_org, 'APV-113', 'apv-1-1-1-3-arbete-pa-vag-grundkompetens', 'APV 1.1–1.3 Arbete på väg (grundkompetens)', 'Helt digital grundkompetens för arbete på väg',",
     "      'Grundläggande kompetens för att få arbeta på eller i anslutning till vägarbetsplatser. Helt digital kurs för APV nivå 1.1–1.3.',",
     "      'Den här utbildningen ger dig den grundläggande kompetens som krävs för att få arbeta på eller i anslutning till vägarbetsplatser. Kursen är helt digital och riktar sig till alla som behöver APV nivå 1.1–1.3, vilket omfattar både arbetare, maskinförare och förare av väghållningsfordon.',",
     "      'Säkerhet', 'self_paced', 435, 'draft', array['apv','arbete på väg','bygg'], 'APV 1.1–1.3 Arbete på väg – digital grundkompetens', array['Trafiksäkerhet och olycksförebyggande','Lagar och regler','Arbetsmiljö, roller och ansvar','Personlig skyddsutrustning','Riskanalys'], 'Diagnostiska prov efter varje del och ett avslutande slutprov som kan göras obegränsat antal gånger.') returning id into v_course;",
     "  insert into public.vihem_kp_course_versions (organisation_id, course_id, version, status, sequential) values (v_org, v_course, 1, 'draft', false) returning id into v_ver;"]
def question(x_text, topic, ans, tags, key):
    nc = sum(a[key] == 't' for a in ans)
    L.append(f"  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, {q(topic)}, '{'multiple' if nc > 1 else 'single'}', {q(x_text)}, array{tags}) returning id into v_q;")
for mi, c in enumerate(order, 1):
    t = cats[c]['name_sv']
    L.append(f"  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, {q(t)}, {mi}) returning id into v_mod;")
    for li, s in enumerate(sorted(mods[c], key=lambda x: int(x['sequence'] or 0)), 1):
        cat = s['slide_category']; mins = max(1, round(float(s['completion_time'] or 0.1) * 60)); kind = {'article': 'content', 'video': 'video', 'quiz': 'quiz'}[cat]
        rule = '{"type":"quiz_pass"}' if kind == 'quiz' else '{"type":"view"}'
        L.append(f"  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, {q(s['name_sv'])}, '{kind}', {li}, {mins}, '{rule}'::jsonb) returning id into v_les;")
        if cat == 'article': L.append(f"  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', {q(md(s['html_content']))}));")
        elif cat == 'video': L.append(f"  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'link', 1, jsonb_build_object('url', {q(s['video_url'])}, 'title', 'Filmen i Odoo/Google Drive – ladda upp filen som videomedia och ersätt denna länk'));")
        else:
            qs = [x for x in sq if x['slide_id'] == s['id']]
            L.append(f"  insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, max_attempts, randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete) values (v_org, v_ver, v_les, 'quiz', {q(s['name_sv'])}, {len(qs)}, 60, null, true, true, 'per_question', true, false) returning id into v_exam;")
            for k, x in enumerate(sorted(qs, key=lambda x: int(x['sequence'] or 0)), 1):
                ans = [a for a in sa if a['question_id'] == x['id']]; question(x['question_sv'], t, ans, "['odoo-apv','diagnostiskt']", 'is_correct')
                for j, a in enumerate(ans): L.append(f"  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, {q(a['text_sv'])}, {'true' if a['is_correct'] == 't' else 'false'}, {q(a['comment_sv'])}, {j + 1});")
                L.append(f"  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, {k});")
L.append(f"  insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, max_attempts, randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete) values (v_org, v_ver, null, 'final', 'Slutprov APV 1.1–1.3', {len(fq)}, 80, null, true, true, 'after_attempt', false, true) returning id into v_exam;")
for k, x in enumerate(sorted(fq, key=lambda x: int(x['sequence'] or 0)), 1):
    ans = sorted([a for a in fa if a['question_id'] == x['id']], key=lambda a: int(a['sequence'] or 0)); question(x['title_sv'], 'Slutprov', ans, "['odoo-apv','slutprov']", 'is_correct')
    for j, a in enumerate(ans): L.append(f"  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, {q(a['value_sv'])}, {'true' if a['is_correct'] == 't' else 'false'}, {j + 1});")
    L.append(f"  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, {k});")
L += ["  raise notice 'APV-113 importerad: % moduler, % lektioner, % frågor', (select count(*) from public.vihem_kp_modules where version_id = v_ver), (select count(*) from public.vihem_kp_lessons where version_id = v_ver), (select count(*) from public.vihem_kp_questions where organisation_id = v_org and 'odoo-apv' = any(tags));", "end $$;", "commit;"]
open('scripts/kp/odoo-import-apv.sql', 'w').write('\n'.join(L) + '\n')
