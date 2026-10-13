-- Importerar APV 1.1–1.3 ur Odoo-exporten (texter, diagnostiska prov, slutprov) som UTKAST. Ersätter ett tidigare utkast (APV-113).
-- Ej importerat: de 11 dokumentavsnitten (saknar filer i Odoo), videon (endast Google Drive-länk) samt pris/produkt. Genererad av odoo-build-import.py.
begin;
do $$
declare v_org uuid := '38fe702d-e72c-49a2-9750-5e0b6934959b'; v_course uuid; v_ver uuid; v_mod uuid; v_les uuid; v_q uuid; v_exam uuid;
begin
  if exists (select 1 from public.vihem_kp_courses c where c.organisation_id = v_org and c.code = 'APV-113' and c.status <> 'draft') then raise exception 'APV-113 är inte ett utkast – avbryter'; end if;
  delete from public.vihem_kp_exam_questions where exam_id in (select e.id from public.vihem_kp_exams e join public.vihem_kp_course_versions v on v.id = e.version_id join public.vihem_kp_courses c on c.id = v.course_id where c.code = 'APV-113' and c.organisation_id = v_org);
  delete from public.vihem_kp_courses where organisation_id = v_org and code = 'APV-113';
  delete from public.vihem_kp_questions where organisation_id = v_org and 'odoo-apv' = any(tags);
  insert into public.vihem_kp_courses (organisation_id, code, slug, title, subtitle, summary, description, category, delivery_form, estimated_minutes, status, tags, seo_title, objectives, exam_info)
    values (v_org, 'APV-113', 'apv-1-1-1-3-arbete-pa-vag-grundkompetens', 'APV 1.1–1.3 Arbete på väg (grundkompetens)', 'Helt digital grundkompetens för arbete på väg',
      'Grundläggande kompetens för att få arbeta på eller i anslutning till vägarbetsplatser. Helt digital kurs för APV nivå 1.1–1.3.',
      'Den här utbildningen ger dig den grundläggande kompetens som krävs för att få arbeta på eller i anslutning till vägarbetsplatser. Kursen är helt digital och riktar sig till alla som behöver APV nivå 1.1–1.3, vilket omfattar både arbetare, maskinförare och förare av väghållningsfordon.',
      'Säkerhet', 'self_paced', 435, 'draft', array['apv','arbete på väg','bygg'], 'APV 1.1–1.3 Arbete på väg – digital grundkompetens', array['Trafiksäkerhet och olycksförebyggande','Lagar och regler','Arbetsmiljö, roller och ansvar','Personlig skyddsutrustning','Riskanalys'], 'Diagnostiska prov efter varje del och ett avslutande slutprov som kan göras obegränsat antal gånger.') returning id into v_course;
  insert into public.vihem_kp_course_versions (organisation_id, course_id, version, status, sequential) values (v_org, v_course, 1, 'draft', false) returning id into v_ver;
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 1 – Trafiksäkerhet & olycksförebyggande', 1) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Trafiksäkerhet & olycksförebyggande', 'content', 1, 5, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', '**Mål:** Förstå varför trafiksäkerhet är grunden i allt arbete på väg.

- Varje år sker olyckor där vägarbetare och trafikanter skadas eller dör.
- Olyckorna beror ofta på:
  - För hög hastighet
  - Bristande uppmärksamhet (mobil, stress, trötthet)
  - Dålig utmärkning av arbetsplatsen
- Förebygg olyckor genom:
  - Tydlig planering
  - Rätt skyltning och avstängning
  - Användning av personlig skyddsutrustning
  - Att alltid sätta säkerhet före tidsplan'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Trafiksäkerhet & Olycksförebyggande', 'video', 2, 10, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'link', 1, jsonb_build_object('url', 'https://drive.google.com/file/d/1SuP0qc1L_rXjFyKXdEB62FOuRC3sXdi4/view?usp=sharing', 'title', 'Filmen i Odoo/Google Drive – ladda upp filen som videomedia och ersätt denna länk'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Trafiksäkerhet & Olycksförebyggande', 'content', 3, 15, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', '### Del 1:

Trafiksäkerhet är grunden för allt arbete på väg. Varje år sker olyckor där både vägarbetare och trafikanter skadas allvarligt – ibland med dödlig utgång. Ofta sker olyckorna trots att arbetsplatsen varit korrekt utmärkt. Det visar hur sårbar situationen är när människor arbetar nära passerande trafik.

**Vanliga orsaker till olyckor**

- För hög hastighet hos förbipasserande fordon.
- Bristande uppmärksamhet hos förare (mobiltelefon, stress, trötthet).
- Felaktig eller otydlig skyltning och avspärrning.
- Dålig sikt på grund av mörker, dimma eller kurvor.
- Att arbetstagare inte använder korrekt skyddsutrustning.

**Hur kan olyckor förebyggas?**

- Arbetsplatsen måste alltid planeras med säkerhet i fokus. Det innebär att man i förväg analyserar risker och väljer rätt åtgärder.
- Alla arbetstagare ska vara väl utbildade i APV och känna till sina roller.
- Vägarbetsplatsen ska vara tydligt utmärkt med vägmärken, barriärer och belysning.
- Hastigheten för passerande trafik ska sänkas så långt det är möjligt.
- Personlig skyddsutrustning ska alltid användas, även om arbetet bara pågår en kort stund.

**Exempel**

En vägarbetare sopar väggrenen på en landsväg där bilarna passerar i 90 km/h. Även om arbetsområdet är korrekt markerat räcker ett ögonblicks ouppmärksamhet från en bilförare för att olyckan ska vara framme. Om arbetsplatsen i stället hade planerat in en tillfällig hastighetssänkning och tydligare avspärrningar hade risken minskat betydligt.

Sammanfattning: Trafiksäkerhet handlar inte om att göra arbetet bekvämt, utan om att alla ska komma hem oskadda efter arbetsdagen.'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 1', 'quiz', 4, 15, '{"type":"quiz_pass"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, max_attempts, randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete) values (v_org, v_ver, v_les, 'quiz', 'Diagnostiskt prov Del 1', 3, 60, null, true, true, 'per_question', true, false) returning id into v_exam;
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 1 – Trafiksäkerhet & olycksförebyggande', 'single', 'Vad är den vanligaste orsaken till olyckor vid vägarbeten?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Buller', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'För hög hastighet och ouppmärksamma förare', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Brist på verktyg', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Dålig planering av arbetet', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 1);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 1 – Trafiksäkerhet & olycksförebyggande', 'single', 'Vilken är den viktigaste åtgärden för att förebygga olyckor?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Att arbetet går snabbt', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Att använda tunga maskiner', false, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Att riskanalys görs och säkerheten prioriteras', true, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Att arbetsplatsen är liten', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 2);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 1 – Trafiksäkerhet & olycksförebyggande', 'single', 'Varför används varselkläder och skyltar vid vägarbete?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'För att det är lagstadgat', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'För att arbetet ska synas tydligt för trafikanter', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'För att personalen ska se snyggare ut', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'För att spara pengar', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 3);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 2 - Lagar och regler', 2) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Lagar och regler', 'content', 1, 5, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', '**Mål:** Känna till de viktigaste lagarna och styrande dokumenten.

- **Trafikförordningen (TRF kap. 12)** – regler för arbete på väg
- **Arbetsmiljölagen (AML)** – arbetsgivarens ansvar för säkerhet och hälsa
- **Trafikverkets styrande dokument:**
  - TDOK 2018:0371 – Kompetenskrav
  - TDOK 2018:0372 – Råd och vägledning
  - TDOK 2012:86 – Tekniska krav på utmärkning och skydd
- Alla på arbetsplatsen är skyldiga att följa gällande lagar och krav'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Lagar och regler', 'content', 2, 15, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', 'Arbete på väg styrs av flera lagar och styrande dokument. Dessa regler finns för att skydda både vägarbetare och trafikanter. Som arbetstagare är det viktigt att känna till grunderna, även om arbetsgivaren har huvudansvaret.

**Trafikförordningen (TRF, kapitel 12)**

- Reglerar arbete på väg i Sverige.
- Innehåller bestämmelser om hur vägar får stängas av, när vägmärken får sättas upp och hur trafiken ska regleras.
- Syftet är att upprätthålla både framkomlighet och säkerhet.

**Arbetsmiljölagen (AML)**

- Reglerar arbetsgivarens ansvar för arbetsmiljön.
- Arbetsgivaren ska förebygga risker, utbilda personalen och se till att rätt skyddsutrustning används.
- Arbetstagaren har skyldighet att följa instruktioner och använda skyddsutrustning.

**Trafikverkets styrande dokument (TDOK)**

- **TDOK 2018:0371** – anger vilka kompetenser som krävs för olika roller (1.1, 1.2, 1.3 osv.).
- **TDOK 2018:0372** – råd och vägledning om hur reglerna kan tillämpas i praktiken.
- **TDOK 2012:86** – tekniska krav på vägmärken, barriärer, fordon och annan utrustning.

**Varför är det viktigt att följa lagar och regler?**

- För att minska risken för olyckor.
- För att arbetsgivaren ska uppfylla sitt ansvar enligt lag.
- För att du som arbetstagare ska veta vad som gäller och kunna arbeta säkert.

**Exempel**

Ett vägarbete ska utföras på en väg med hög trafikintensitet. Arbetsgivaren planerar in tydliga avstängningar, hastighetssänkning och en trafiklots. Om detta inte görs kan både vägarbetare och trafikanter utsättas för livsfara – och arbetsgivaren kan bli juridiskt ansvarig.

Sammanfattning: Lagar och regler är inte hinder – de är skydd som gör att alla kan arbeta tryggt och komma hem oskadda.'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 2', 'quiz', 3, 15, '{"type":"quiz_pass"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, max_attempts, randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete) values (v_org, v_ver, v_les, 'quiz', 'Diagnostiskt prov Del 2', 3, 60, null, true, true, 'per_question', true, false) returning id into v_exam;
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 2 - Lagar och regler', 'single', 'Vilket dokument reglerar arbete på väg i Sverige?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Trafikförordningen kapitel 12', true, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Arbetsmiljöverkets broschyr', false, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Körkortslagen', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Arbetsledarens instruktioner', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 1);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 2 - Lagar och regler', 'single', 'Vem har det yttersta ansvaret för arbetsmiljön?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Arbetstagaren', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Trafikverket', false, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Arbetsgivaren', true, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Polisen', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 2);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 2 - Lagar och regler', 'single', 'Vad anger TDOK 2018:0371?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Vilka fordon som får användas', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Vilka kompetenser som krävs för olika roller', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Hur man gör en riskanalys', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Regler för vägskyltars storlek', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 3);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 3 - Arbetsmiljö, roller och ansvar', 3) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Arbetsmiljö, roller och ansvar', 'content', 1, 5, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', '**Mål:** Förstå vem som ansvarar för vad.

- **Arbetsgivaren:** Ska se till att personalen har rätt utbildning och utrustning
- **Arbetsledaren:** Ansvarar för planering och samordning av arbetet
- **Arbetstagaren:** Ska följa regler, använda utrustning och rapportera risker
- **Roller på arbetsplatsen:**
  - Entreprenör
  - Flaggvakt
  - Lotsförare
  - Trafikvakt'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Arbetsmiljö, roller och ansvar', 'content', 2, 15, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', 'Arbete på väg är inte bara en fråga om trafiksäkerhet. Det är också en arbetsmiljöfråga. Alla som arbetar på eller vid väg ska kunna göra sitt jobb utan att riskera sin hälsa eller sitt liv. Därför finns tydliga roller och ansvarsfördelning.

**Arbetsgivarens ansvar**

- Arbetsgivaren har det yttersta ansvaret för arbetsmiljön enligt Arbetsmiljölagen.
- Ska se till att riskbedömningar görs innan arbetet startar.
- Måste ge rätt utbildning och utrustning till alla anställda.
- Är skyldig att vidta åtgärder för att förebygga olyckor (t.ex. barriärer, sänkta hastigheter, lots eller flaggvakt).

**Arbetsledarens ansvar**

- Leder det dagliga arbetet på plats.
- Säkerställer att arbetsplatsen är korrekt utmärkt.
- Fördelar arbetsuppgifter och ser till att alla följer reglerna.
- Har skyldighet att stoppa arbetet om säkerheten inte kan garanteras.

**Arbetstagarens ansvar**

- Ska följa instruktioner från arbetsledaren.
- Måste använda personlig skyddsutrustning.
- Ska rapportera brister eller risker till arbetsledaren.
- Har skyldighet att avbryta arbetet om säkerheten hotas.

**Andra roller på vägarbetsplatsen**

- **Entreprenören:** den organisation som utför arbetet och har samordningsansvar.
- **Flaggvakt:** reglerar trafiken manuellt, t.ex. vid smala passager.
- **Lotsförare:** leder trafiken förbi arbetsplatsen när enkelriktad passage krävs.
- **Trafikvakt:** övervakar och ger anvisningar till trafikanterna.

**Exempel**

Vid en beläggningsarbeten är entreprenören ansvarig för helheten. Arbetsledaren ser till att skyltar och barriärer placeras rätt. En flaggvakt styr trafiken vid en smal passage. Samtidigt ansvarar varje arbetstagare för att bära sin skyddsutrustning och följa instruktionerna. Alla delar måste fungera för att olyckor ska undvikas.

Sammanfattning: Arbetsmiljö handlar om samarbete. När alla känner till sitt ansvar kan arbetsplatsen bli både säker och effektiv.'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 3', 'quiz', 3, 15, '{"type":"quiz_pass"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, max_attempts, randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete) values (v_org, v_ver, v_les, 'quiz', 'Diagnostiskt prov Del 3', 3, 60, null, true, true, 'per_question', true, false) returning id into v_exam;
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 3 - Arbetsmiljö, roller och ansvar', 'single', 'Vem har ansvar att stoppa arbetet om säkerheten inte kan garanteras?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Arbetstagaren', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Arbetsgivaren', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Trafikanten', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Entreprenören', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 1);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 3 - Arbetsmiljö, roller och ansvar', 'single', 'Vad är arbetstagarens främsta ansvar?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Planera arbetsledningen', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Bestämma hastigheten för trafikanterna', false, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Följa instruktioner och använda skyddsutrustning', true, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Kontrollera TA-planen', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 2);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 3 - Arbetsmiljö, roller och ansvar', 'single', 'Vilken av följande roller reglerar trafiken manuellt?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Lotsförare', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Flaggvakt', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Arbetsledare', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Trafikant', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 3);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 4 – Personlig skyddsutrustning', 4) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Personlig skyddsutrustning', 'content', 1, 5, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', '**Mål:** Veta vilken skyddsutrustning som krävs och varför.

- **Varselkläder klass 3** – alltid krav på vägarbetsplatser med trafik
- **Skyddshjälm** – vid risk för fallande föremål, maskiner eller särskilda arbeten
- **Skyddsskor** – med stålhätta och halkskydd
- **Reflexer/armband** – vid mörker
- **Hörselskydd, skyddsglasögon, handskar** – vid behov
- Skyddsutrustning ska alltid vara hel, ren och godkänd'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Personlig skyddsutrustning', 'content', 2, 15, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', 'Vid arbete på väg är **personlig skyddsutrustning (PPE)** livsviktig. Även om arbetsplatsen är korrekt utmärkt och riskerna har analyserats, finns alltid en risk att något händer. Skyddsutrustningen kan då vara skillnaden mellan liv och död.

**Varselkläder**

- Ska alltid vara **klass 3** vid arbete på väg där fordonstrafik förekommer.
- Varselkläder klass 3 innebär hel dräkt eller kombination av plagg som täcker armar och ben med reflexer runtom.
- Syftet är att du alltid ska synas – både dag och natt, i alla väder.

**Skyddshjälm**

- Används där det finns risk för fallande föremål, maskiner i drift eller annan fara mot huvudet.
- Många arbetsplatser har hjälmkrav som standard.
- Ska alltid bäras korrekt fastspänd.

**Skyddsskor**

- Försedda med tåhätta och halkskydd.
- Skyddar mot tunga föremål, vassa kanter och halka.

**Övrig utrustning vid behov**

- **Reflexband eller lampa** vid arbete i mörker.
- **Skyddsglasögon** vid slipning, kapning eller risk för stänk.
- **Hörselskydd** vid arbete nära bullrande maskiner.
- **Handskar** för att undvika skärskador eller kemiska risker.

**Ansvar för utrustningen**

- Arbetsgivaren ansvarar för att utrustningen delas ut, är CE-märkt och uppfyller kraven.
- Arbetstagaren ansvarar för att utrustningen används och hålls i gott skick.
- Trasig eller smutsig utrustning kan vara lika farlig som att inte ha någon alls.

**Exempel**

En vägarbetare som sopar vägrenen i mörker syns tydligt tack vare varselkläder och reflexband. En annan som arbetar utan reflexer riskerar att helt försvinna i mörkret – med livsfara som följd.

Sammanfattning: Skyddsutrustningen är inte en rekommendation – den är en nödvändighet.'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 4', 'quiz', 3, 15, '{"type":"quiz_pass"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, max_attempts, randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete) values (v_org, v_ver, v_les, 'quiz', 'Diagnostiskt prov Del 4', 3, 60, null, true, true, 'per_question', true, false) returning id into v_exam;
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 4 – Personlig skyddsutrustning', 'single', 'Vilken varselklass är krav vid arbete på väg med trafik?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Klass 1', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Klass 2', false, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Klass 3', true, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Ingen särskild klass', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 1);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 4 – Personlig skyddsutrustning', 'single', 'När ska skyddshjälm användas?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Endast vid regn', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Vid risk för fallande föremål eller vid arbete med maskiner', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Endast vid arbete på stora arbetsplatser', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Bara om arbetsledaren säger till', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 2);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 4 – Personlig skyddsutrustning', 'single', 'Vems ansvar är det att skyddsutrustningen används på rätt sätt?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Arbetsgivaren', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Arbetstagaren', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Trafikverket', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Kommunen', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 3);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 5 - Riskanalys', 5) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Riskanalys', 'content', 1, 5, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', '**Mål:** Förstå hur man bedömer risker innan arbetet startar.

- **Riskinventering:** Lista alla tänkbara risker
- **Riskbedömning:** Bedöm sannolikhet + konsekvens
- **Handlingsplan:** Bestäm åtgärder (t.ex. hastighetssänkning, barriärer, varselkläder)
- Exempel på risker:
  - Hög trafikmängd
  - Begränsad sikt
  - Dåligt väder
  - Maskiner nära personal'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Riskanalys', 'content', 2, 15, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', 'Innan ett arbete på väg startar måste en **riskanalys** göras. Riskanalysen är grunden för en säker arbetsplats. Utan den vet man inte vilka hot som finns – eller hur de ska hanteras.

**Vad är riskanalys?**

En riskanalys är en systematisk genomgång av arbetsplatsen för att identifiera faror och planera åtgärder. Den består av tre steg:

- **Riskinventering** – Vilka risker kan uppstå?
- **Riskbedömning** – Hur allvarliga är de, och hur sannolika?
- **Handlingsplan** – Vad ska vi göra för att minimera riskerna?

**Exempel på risker att analysera**

- Trafikintensitet (många fordon, tung trafik).
- Verklig hastighet (ofta högre än den skyltade).
- Begränsad sikt (kurvor, backkrön, mörker, dimma).
- Väderförhållanden (regn, snö, halka).
- Arbetets art (maskiner, buller, damm, heta arbeten).
- Närhet till oskyddade trafikanter (gåendes, cyklister).

**Riskbedömning**

Varje risk bedöms utifrån:

- **Sannolikhet** (hur stor chans att det händer).
- **Konsekvens** (hur allvarligt blir det om det händer). Exempel: Ett fordon som kör i 90 km/h nära arbetsplatsen = hög sannolikhet + allvarlig konsekvens → mycket hög risk.

**Handlingsplan**

När riskerna är kartlagda bestämmer man åtgärder.

Exempel på åtgärder:

- Tillfälliga hastighetssänkningar.
- Skyddsräcken eller barriärer.
- Lots eller flaggvakt.
- Extra belysning.
- Utökad skyltning.

**Vem ansvarar?**

- Arbetsgivaren ansvarar för att riskanalys alltid görs.
- Arbetsledaren ansvarar för att den genomförs på plats och att alla i teamet känner till den.
- Arbetstagaren ska delta aktivt, rapportera risker och följa planen.

**Exempel**

En arbetsgrupp ska klippa gräs längs en 70-väg. Riskanalysen visar att sikten är dålig och hastigheten hög. Åtgärden blir därför att sätta upp extra varningsskyltar, sänka hastigheten och använda lotsbil. Utan riskanalysen hade arbetet kunnat utföras helt oskyddat – med livsfara som följd.

Sammanfattning: En riskanalys är inte pappersarbete. Den är en livräddande plan.'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 5', 'quiz', 3, 15, '{"type":"quiz_pass"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, max_attempts, randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete) values (v_org, v_ver, v_les, 'quiz', 'Diagnostiskt prov Del 5', 2, 60, null, true, true, 'per_question', true, false) returning id into v_exam;
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 5 - Riskanalys', 'single', 'Vilka är de tre stegen i en riskanalys', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Planering – byggande – kontroll', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Inventering – bedömning – handlingsplan', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Utbildning – övning – rapportering', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Skyltning – avstängning – uppföljning', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 1);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 5 - Riskanalys', 'single', 'Vad menas med ”verklig hastighet”?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Den hastighet som är skyltad', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Den hastighet trafikanterna faktiskt kör i', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Den hastighet arbetsledaren bestämmer', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Hastigheten i TA-planen', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 2);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 6 – Typer av vägarbeten', 6) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Typer av vägarbeten', 'content', 1, 5, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', '**Mål:** Känna till skillnaderna mellan olika typer av arbetsplatser.

- **Tillfälliga arbetsplatser:** kortvariga arbeten (t.ex. lagning av hål)
- **Rörliga arbetsplatser:** arbetet flyttas med fordon (t.ex. sopning, snöröjning)
- **Fasta arbetsplatser:** längre projekt (t.ex. vägbyggen)
- Entreprenören ansvarar för att arbetsplatsen är rätt utmärkt oavsett typ'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Typer av vägarbeten', 'content', 2, 15, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', 'Alla vägarbeten ser inte likadana ut. Därför delas de in i olika typer. Indelningen är viktig eftersom den avgör vilka risker som finns och vilka skyddsåtgärder som krävs.

**1. Tillfälliga arbetsplatser**

- Korta insatser som oftast varar i några minuter eller timmar.
- Exempel: laga ett potthål, byta en skylt, måla vägmarkeringar.
- Risk: Ofta snabbt uppsatta arbetsplatser där trafikanterna inte hinner anpassa sig.
- Åtgärder: Tydlig utmärkning, mobila skydd, ofta extra personal för trafikdirigering.

**2. Rörliga arbetsplatser**

- Arbetsplatser som flyttar sig hela tiden i takt med arbetet.
- Exempel: sopning, snöröjning, gräsklippning längs väg.
- Risk: Svår för trafikanter att förutse var arbetsområdet börjar/slutar.
- Åtgärder: Väghållningsfordon med tydlig utmärkning och varningsljus, ibland följebil som varnar.

**3. Fasta arbetsplatser**

- Längre arbeten som pågår i dagar, veckor eller månader.
- Exempel: vägbyggen, broreparationer, beläggningsarbete.
- Risk: Hög exponering – arbetare befinner sig nära trafiken under lång tid.
- Åtgärder: Omfattande planering, TA-plan (trafikanordningsplan), barriärer, hastighetssänkning, lots eller flaggvakter.

**Vem har ansvar?**

- Entreprenören ansvarar för att alla arbetsplatser, oavsett typ, är korrekt utmärkta.
- Arbetsledaren ser till att planen följs.
- Arbetstagaren ska känna till vilken typ av arbetsplats det gäller och följa säkerhetsrutinerna.

**Exempel**

En kort lagning av ett potthål kräver snabb uppsättning av skyltar och varningsbil. Ett brobygge däremot kräver en detaljerad TA-plan med avstängningar, barriärer och trafiklotsar.

Sammanfattning: Alla vägarbeten är olika – men kravet på säkerhet är alltid detsamma.'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 6', 'quiz', 3, 15, '{"type":"quiz_pass"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, max_attempts, randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete) values (v_org, v_ver, v_les, 'quiz', 'Diagnostiskt prov Del 6', 2, 60, null, true, true, 'per_question', true, false) returning id into v_exam;
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 6 – Typer av vägarbeten', 'single', 'Vilken typ av arbetsplats flyttar sig hela tiden i takt med arbetet?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Tillfällig', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Rörlig', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Fast', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Kombinerad', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 1);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 6 – Typer av vägarbeten', 'single', 'Vilken typ av arbetsplats kräver oftast en detaljerad TA-plan och barriärer?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Tillfällig', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Rörlig', false, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Fast', true, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Ingen', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 2);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 7 – Begränsningar av arbetsplatsen', 7) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Begränsningar av arbetsplatsen', 'content', 1, 5, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', '**Mål:** Förstå hur arbetsplatsen utformas för säkerhet.

- **Skyddszon:** område mellan trafik och arbetszon
- **Arbetszon:** där själva arbetet sker
- **Buffertzon:** tar emot fordon som kör fel
- **Framkomlighet:** vägar ska planeras så trafiken kan passera på ett säkert sätt
- **Verklig hastighet:** den hastighet trafiken faktiskt håller, ofta högre än skyltad → måste beaktas i riskanalysen'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Begränsningar av arbetsplatsen', 'content', 2, 15, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', 'En vägarbetsplats måste alltid avgränsas tydligt för att skydda både arbetare och trafikanter. Avgränsningarna bestämmer var trafiken får köra och var arbetet får ske.

**Zonindelning**

Arbetsplatsen delas in i olika zoner för att skapa ordning och säkerhet:

- **Skyddszon**

- Området mellan trafiken och arbetszonen.
- Fungerar som en buffert där inga arbetare ska vistas.
- Syftet är att ge extra skydd om ett fordon skulle komma ur kurs.

- **Arbetszon**

- Där själva arbetet utförs.
- Endast behörig personal får vistas här.
- Måste vara tillräckligt stor för att arbetet ska kunna ske säkert.

- **Buffertzon**

- Ett extra skyddsområde som kan ta emot fordon som kör fel.
- Ska alltid hållas fritt från personal och material.
- Placeras ofta mellan arbetszon och trafik.

**Framkomlighet**

- Trafikanter ska kunna passera arbetsplatsen på ett säkert sätt.
- Passager ska vara tillräckligt breda, tydligt markerade och fria från hinder.
- Om arbetsytan blir för smal måste trafiken regleras med lots eller vakt.

**Verklig hastighet**

- Viktigt att känna till skillnaden mellan **skyltad hastighet** och **verklig hastighet**.
- Verklig hastighet = den hastighet trafikanterna faktiskt kör i.
- Riskanalysen måste alltid utgå från den verkliga hastigheten.

**Exempel**

Vid ett arbete på en 70-väg placeras en arbetszon med maskiner. Framför arbetszonen sätts en skyddszon och en buffertzon ut. Trafiken får passera förbi i ett körfält, reglerat av flaggvakt. Om zonerna inte funnits hade arbetarna stått oskyddade bara några meter från bilarna.

Sammanfattning: Rätt zonindelning och tydlig avgränsning är avgörande för säkerheten.'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 7', 'quiz', 3, 15, '{"type":"quiz_pass"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, max_attempts, randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete) values (v_org, v_ver, v_les, 'quiz', 'Diagnostiskt prov Del 7', 2, 60, null, true, true, 'per_question', true, false) returning id into v_exam;
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 7 – Begränsningar av arbetsplatsen', 'single', 'Vilken zon är området mellan trafiken och arbetszonen?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Arbetszon', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Skyddszon', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Buffertzon', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Säkerhetszon', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 1);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 7 – Begränsningar av arbetsplatsen', 'single', 'Vilken zon ska alltid hållas fri från personal och material?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Skyddszon', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Arbetszon', false, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Buffertzon', true, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Serviceläge', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 2);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 8 – Vägmärken och skydd', 8) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Vägmärken och skydd', 'content', 1, 5, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', '**Mål:** Känna igen vägmärken och skydd vid vägarbeten.

- **Vägmärken vid vägarbete:** särskilda skyltar med orange botten
- **Allmänna vägmärken:** påminnelse om grundläggande trafikregler
- **Tunga skydd:** räcken, barriärer, betongblock som skyddar personal
- Alla vägmärken och skydd ska följa Trafikverkets tekniska krav'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Vägmärken och skydd', 'content', 2, 15, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', 'För att trafikanter ska förstå att vägarbete pågår krävs tydlig och korrekt **utmärkning**. Vägmärken och skydd är centrala delar i trafiksäkerheten. De talar om för bilister vad som gäller, var de ska köra och vilken hastighet som är säker.

**Vägmärken vid vägarbete**

- Har **orange bottenfärg** för att skiljas från vanliga vägmärken.
- Används för att uppmärksamma trafikanterna på arbete på väg och för att ge särskilda anvisningar.
- Exempel: ”Vägarbete”, ”Begränsad hastighet”, ”Körfält upphör”.

**Allmänna vägmärken**

- Används ofta i kombination med vägarbetsskyltar.
- Exempel: hastighetsskyltar, varningsmärken, påbudsmärken.
- Dessa gäller på samma sätt som i övrig trafik.

**Skydd och barriärer**

- **Tunga skydd** (t.ex. betong- eller stålräcken) används för att skydda personal från trafiken.
- **Tillfälliga skydd** (t.ex. plastbarriärer, vattenfyllda barriärer) används vid kortare eller mindre riskfyllda arbeten.
- **Skyddsbilar/TMA-fordon** (Truck Mounted Attenuator) används ofta vid rörliga arbeten. De tar upp krockenergin om en bil kör på dem.

**Utmärkning av arbetsplats**

- Ska alltid följa Trafikverkets tekniska krav (TDOK 2012:86).
- Vägmärken ska placeras i rätt ordning, med rätt avstånd och höjd.
- Det ska alltid vara tydligt för trafikanterna var arbetsplatsen börjar, hur de ska köra förbi och var arbetsplatsen slutar.

**Exempel**

Vid ett beläggningsarbete på en landsväg används först en skylt ”Vägarbete” med orange botten. Därefter placeras skyltar som sänker hastigheten till 50 km/h, följt av barriärer och ett TMA-fordon som skyddar arbetarna. Tydlig utmärkning gör att trafikanterna kan förbereda sig i tid och minska risken för olyckor.

Sammanfattning: Rätt vägmärken och skydd räddar liv – både för arbetare och trafikanter.'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 8', 'quiz', 3, 15, '{"type":"quiz_pass"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, max_attempts, randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete) values (v_org, v_ver, v_les, 'quiz', 'Diagnostiskt prov Del 8', 2, 60, null, true, true, 'per_question', true, false) returning id into v_exam;
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 8 – Vägmärken och skydd', 'single', 'Vilken färg har vägmärken vid vägarbete?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Blå', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Gul', false, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Orange', true, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Grön', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 1);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 8 – Vägmärken och skydd', 'single', 'Vad är syftet med ett TMA-fordon?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Att reglera trafikens hastighet', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Att absorbera kraften vid en påkörning', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Att visa vägen för trafikanter', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Att mäta trafikflödet', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 2);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 9 – Fordon och utrustning', 9) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Fordon och utrustning', 'content', 1, 5, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', '**Mål:** Förstå kraven på fordon och redskap vid vägarbeten.

- **Väghållningsfordon:** ska vara utmärkta med gult varningsljus, reflexer och skyltar
- **Utmärkning av fordon:**
  - Gul varningslykta alltid påslagen vid arbete
  - X2-pil eller blinkpil vid körfältsspärr
  - Reflexer fram, bak och på sidor
- **Last och redskap:** ska vara säkrade och får inte utgöra fara för trafikanter eller personal'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Fordon och utrustning', 'content', 2, 15, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', 'Vid arbete på väg används olika typer av fordon och utrustning. Dessa är inte bara arbetsredskap, utan även en del av säkerheten. Rätt utmärkning och utrustning kan förhindra olyckor och rädda liv.

**Väghållningsfordon**

- Alla fordon som används vid vägarbete räknas som väghållningsfordon.
- Exempel: lastbilar, sopmaskiner, gräsklippare, snöröjningsfordon, beläggningsmaskiner.
- Måste vara godkända för sitt ändamål och hållas i gott skick.

**Krav på utmärkning**

- **Gult varningsljus** ska alltid vara tänt när fordonet arbetar på eller vid vägen.
- **Reflexer** ska finnas fram, bak och på sidor.
- **Skyltar** som varnar för arbete på väg ska sitta tydligt på fordonet.
- **X2-pil eller blinkpil** används när trafiken ska styras om till ett annat körfält.

**Skyddsbilar/TMA-fordon**

- TMA står för Truck Mounted Attenuator.
- Det är ett skydd som monteras bak på fordonet.
- Tar upp kraften vid en kollision och skyddar både arbetare och förare.
- Används ofta vid rörliga arbeten eller där risken för påkörning är hög.

**Last och redskap**

- All last måste vara säkrad.
- Redskap som sticker ut (t.ex. plogblad, kranar) ska märkas ut med reflex eller flagga.
- Osäkrad last kan orsaka både trafikolyckor och skada arbetare.

**Exempel**

En sopmaskin arbetar längs vägrenen. Den har påslaget gult varningsljus, reflexer på alla sidor och en blinkpil som leder trafiken förbi. Bakom kör ett TMA-fordon som skyddar maskinen. Om något fordon kör för nära absorberar TMA:n smällen – och sopföraren undviker att bli påkörd.

Sammanfattning: Fordon och utrustning är inte bara verktyg – de är en del av arbetsplatsens säkerhetssystem.'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 9', 'quiz', 3, 15, '{"type":"quiz_pass"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, max_attempts, randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete) values (v_org, v_ver, v_les, 'quiz', 'Diagnostiskt prov Del 9', 2, 60, null, true, true, 'per_question', true, false) returning id into v_exam;
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 9 – Fordon och utrustning', 'single', 'Vilket ljus ska alltid vara tänt på väghållningsfordon vid arbete på väg?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Blått', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Grönt', false, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Gult', true, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Vitt', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 1);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 9 – Fordon och utrustning', 'single', 'Vad krävs om ett redskap eller last sticker ut från fordonet?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Inget särskilt', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Att det märks ut med reflex eller flagga', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Att det målas svart', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Att fordonet kör långsamt', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 2);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 10 – Trafikdirigering', 10) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Trafikdirigering', 'content', 1, 5, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', '**Mål:** Veta hur trafiken kan styras förbi arbetsplatsen.

- **Med vakt:**
  - Flaggvakt används vid tillfälliga arbeten där trafik måste stoppas
  - Ska vara tydligt utmärkt och ha kontakt med arbetsledare
- **Med lots:**
  - En lotsbil leder trafiken förbi arbetsplatsen
  - Används vid enkelriktad passage
  - Kräver radiosamband och tydlig planering'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Trafikdirigering', 'content', 2, 15, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', 'När arbete utförs på vägar där trafiken inte kan passera fritt krävs **trafikdirigering**. Det handlar om att leda trafiken på ett säkert sätt förbi arbetsplatsen och samtidigt skydda de som arbetar.

Det finns två huvudsakliga sätt att dirigera trafiken:

**1. Trafikdirigering med vakt (flaggvakt)**

- En flaggvakt använder skylt eller flagga för att stoppa och släppa fram trafiken.
- Krävs ofta vid smala passager där endast ett körfält kan användas.
- Flaggvakten ska ha tydlig skyddsutrustning (klass 3 varselkläder) och stå placerad så att trafikanterna ser honom/henne i god tid.
- Viktigt att flaggvakten har direktkontakt med arbetsledaren och andra vakter via radio.

**2. Trafikdirigering med lots**

- En lotsbil leder trafiken förbi arbetsplatsen i båda riktningar.
- Används när sträckan är längre, eller när det är svårt för trafikanterna att själva bedöma när det är säkert att köra.
- Lotsbilen kör i låg hastighet och håller samman trafikflödet.
- Kräver god kommunikation mellan lotsförare, flaggvakter och arbetsledare.

**Varför är trafikdirigering viktig?**

- Den minskar risken för frontalkollisioner vid enkelriktade passager.
- Den sänker hastigheten på fordonen när de passerar arbetsplatsen.
- Den ger arbetarna en tryggare arbetsmiljö.

**Exempel**

Vid ett vägarbete på en landsväg där ena körfältet är avstängt används två flaggvakter som turas om att släppa fram trafiken i en riktning åt gången. Vid ett längre arbete används istället en lotsbil som leder trafiken förbi i samlad grupp.

Sammanfattning: Rätt trafikdirigering skyddar både vägarbetare och trafikanter.'));
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 10', 'quiz', 3, 15, '{"type":"quiz_pass"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, max_attempts, randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete) values (v_org, v_ver, v_les, 'quiz', 'Diagnostiskt prov Del 10', 2, 60, null, true, true, 'per_question', true, false) returning id into v_exam;
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 10 – Trafikdirigering', 'single', 'Vem använder flagga eller skylt för att stoppa trafiken vid smala passager?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Lotsförare', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Flaggvakt', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Arbetsledare', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Trafikant', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 1);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Del 10 – Trafikdirigering', 'single', 'När används en lotsbil?', array['odoo-apv','diagnostiskt']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'När arbetsplatsen är mycket kort', false, '', 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Vid längre sträckor där trafiken behöver ledas i samlad grupp', true, '', 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Endast i tätorter', false, '', 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) values (v_org, v_q, 'Endast på motorväg', false, '', 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 2);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 11 – Avslutning och slutprov', 11) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Avslutning', 'content', 1, 15, '{"type":"view"}'::jsonb) returning id into v_les;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_les, 'text', 1, jsonb_build_object('markdown', 'Nu har du gått igenom hela kursen för **Arbete på väg 1.1–1.3**. Du har fått lära dig grunderna i trafiksäkerhet, lagar och regler, arbetsmiljö, skyddsutrustning, riskanalys, olika typer av arbetsplatser, zonindelning, vägmärken, fordon och trafikdirigering.

**Det viktigaste att komma ihåg:**

- **Alla** som vistas på en vägarbetsplats ska ha minst APV 1.1.
- Förare av väghållningsfordon ska ha APV 1.2.
- Personal som arbetar i vägområdet ska ha APV 1.3.
- Säkerhet går alltid före tid och produktion.
- Arbetsgivaren har det yttersta ansvaret, men alla måste bidra.
- Skyddsutrustning, tydlig utmärkning och riskanalys är grundpelarna i allt arbete på väg.

**Slutprov**

För att bli godkänd i kursen ska du nu genomföra slutprovet.

- Provet består av 20–25 frågor.
- Frågorna är blandade från alla avsnitt.
- För att bli godkänd krävs **minst 75 % rätt**.

När du har klarat provet får du:

- Ett **kursintyg** (PDF) som visar att du har genomgått utbildningen.
- Information om hur du ger samtycke så att utbildningen kan registreras i **ID06 Kompetensdatabas**.

**Kom ihåg:**

Det här är en grundutbildning. Vid mer avancerade arbetsuppgifter (t.ex. trafikplanering, arbetsledning eller ansvar för TA-planer) krävs vidareutbildning inom APV steg 2 och 3.

Sammanfattning: Arbete på väg handlar om att skapa trygghet – för dig själv, dina kollegor och alla som passerar arbetsplatsen.'));
  insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, max_attempts, randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete) values (v_org, v_ver, null, 'final', 'Slutprov APV 1.1–1.3', 13, 80, null, true, true, 'after_attempt', false, true) returning id into v_exam;
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Slutprov', 'single', 'Vilken kombination orsakar flest olyckor vid vägarbeten?', array['odoo-apv','slutprov']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Hög hastighet och ouppmärksamhet', true, 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Dåligt väder', false, 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Få maskiner', false, 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Kort arbetsplats', false, 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 1);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Slutprov', 'single', 'Vad är det viktigaste vid planering av vägarbete?', array['odoo-apv','slutprov']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Kort arbetstid', false, 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Fler skyltar än vad som behövs', false, 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Att allt sker i dagsljus', false, 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Säkerhet före produktion', true, 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 2);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Slutprov', 'single', 'Vilket dokument reglerar utmärkning/avstängning?', array['odoo-apv','slutprov']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Väglagen', false, 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Trafikförordningen kap 12', true, 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Körkortslagen', false, 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Plan- och bygglagen', false, 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 3);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Slutprov', 'single', 'Arbetsmiljölagen kräver att arbetsgivaren…', array['odoo-apv','slutprov']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Alltid är på plats', false, 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Endast köper skyddsräcken', false, 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Skriver avtal med Trafikverket', false, 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Förebygger risker och utbildar personal', true, 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 4);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Slutprov', 'single', 'Vem kan stoppa arbetet?', array['odoo-apv','slutprov']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Endast Trafikverket', false, 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Flaggvakten', false, 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Ingen', false, 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Arbetsledaren', true, 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 5);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Slutprov', 'single', 'Arbetstagarens främsta ansvar är att…', array['odoo-apv','slutprov']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Planera arbetsplatsen', false, 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Följa instruktioner och använda skyddsutrustning', true, 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Godkänna TA-plan', false, 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Köra lotsbil', false, 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 6);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Slutprov', 'single', 'Avgörande för säker kommunikation är', array['odoo-apv','slutprov']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Tydliga roller och rapporteringsvägar', true, 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Endast skriftliga instruktioner', false, 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Många chattgrupper', false, 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Dagliga sms', false, 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 7);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Slutprov', 'single', 'Vilken varselklass krävs vid arbete nära trafik?', array['odoo-apv','slutprov']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Klass 1', false, 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Klass 2', false, 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Klass 3', true, 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Ingen', false, 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 8);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Slutprov', 'single', 'Trasig skyddsutrustning ska…', array['odoo-apv','slutprov']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Användas vid behov', false, 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Lagas med tejp', false, 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Bytas ut', true, 3);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 9);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Slutprov', 'single', 'När ska riskanalys göras?', array['odoo-apv','slutprov']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Innan arbetet startar', true, 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Endast vid stora projekt', false, 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'När tid finns', false, 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Efter arbetets slut', false, 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 10);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Slutprov', 'single', 'Vad menas med verklig hastighet?', array['odoo-apv','slutprov']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Skyltad hastighet', false, 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Planerad hastighet', false, 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Faktisk körhastighet på plats', true, 3);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 11);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Slutprov', 'single', 'Vilka steg ingår i riskanalys?', array['odoo-apv','slutprov']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Planera - Köra - Rapportera', false, 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Inventera - Bedöm - Åtgärda', true, 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Skylt - Bygga - Städa', false, 3);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 12);
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, tags) values (v_org, 'Slutprov', 'single', 'En rörlig arbetsplats är...', array['odoo-apv','slutprov']) returning id into v_q;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Lång på samma plats', false, 1);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Saknar skyltning', false, 2);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Den flyttar sig kontinuerligt', true, 3);
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_q, 'Finns bara i städer', false, 4);
  insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, sort_order) values (v_exam, v_q, v_org, 13);
  raise notice 'APV-113 importerad: % moduler, % lektioner, % frågor', (select count(*) from public.vihem_kp_modules where version_id = v_ver), (select count(*) from public.vihem_kp_lessons where version_id = v_ver), (select count(*) from public.vihem_kp_questions where organisation_id = v_org and 'odoo-apv' = any(tags));
end $$;
commit;
