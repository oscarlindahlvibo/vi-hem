import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, learn } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateOnly, duration } from "../lib/format";
import { Markdown } from "../lib/markdown";
import { Link, navigate, useLocation } from "../lib/router";
import { useSeo } from "../lib/seo";

type Lesson = { id: string; title: string; kind: string; required: boolean; minutes: number; status: string; locked: boolean; resume_position: number };
type Exam = { id: string; kind: string; title: string; question_count: number; pass_percent: number; time_limit_seconds: number | null; max_attempts: number | null; attempts_left: number | null; attempts_used: number; cooldown_seconds_left: number; passed: boolean; best_percent: number; lesson_id: string | null; require_identity: boolean };

export function PlayerPage({ enrollmentId }: { enrollmentId: string }) {
  const { session, ready } = useAuth(); const { search } = useLocation();
  const [data, setData] = useState<any>(null); const [error, setError] = useState(""); const [lessonId, setLessonId] = useState<string>(search.get("lektion") || ""); const [showExam, setShowExam] = useState<string>("");
  useSeo({ title: "Utbildning | Kompetensportalen", noindex: true });
  const load = useCallback(() => learn("course_player", { enrollment_id: enrollmentId }).then((d) => { setData(d); return d; }).catch((e) => { setError((e as ApiError).message); return null; }), [enrollmentId]);
  useEffect(() => { if (ready && !session) navigate(`/logga-in?next=${encodeURIComponent(`/utbildning/${enrollmentId}`)}`); else if (session) void load(); }, [ready, session?.user.id, enrollmentId]);
  useEffect(() => { if (data && !lessonId && !showExam) { const all: Lesson[] = data.modules.flatMap((m: any) => m.lessons); const pick = all.find((l) => l.id === data.enrollment.last_lesson_id && !l.locked) ?? all.find((l) => l.status !== "completed" && !l.locked) ?? all[0]; if (pick) setLessonId(pick.id); } }, [data]);
  if (error) return <section className="section narrow"><p className="notice error" role="alert">{error}</p><Link to="/mina-sidor" className="text-link">← Mina sidor</Link></section>;
  if (!data) return <section className="section narrow"><p className="muted" role="status">Laddar utbildningen…</p></section>;
  const e = data.enrollment; const all: Lesson[] = data.modules.flatMap((m: any) => m.lessons); const idx = all.findIndex((l) => l.id === lessonId); const next = idx >= 0 ? all.slice(idx + 1).find((l) => !l.locked) : undefined;
  const finalExam: Exam | undefined = data.exams.find((x: Exam) => x.kind === "final"); const exam = data.exams.find((x: Exam) => x.id === showExam);
  const open = (id: string) => { setShowExam(""); setLessonId(id); window.scrollTo(0, 0); };
  const download = async (id: string) => { const r = await learn("certificate_pdf", { certificate_id: id }); window.open(r.url, "_blank", "noopener"); };
  return (
    <div className="player">
      <nav className="player-nav" aria-label="Kursinnehåll">
        <Link to="/mina-sidor" className="text-link">← Mina sidor</Link><h3 style={{ marginTop: 12 }}>{data.course.title}</h3>
        <div className="progress" aria-label={`${e.progress_percent} % genomfört`}><i style={{ width: `${e.progress_percent}%` }} /></div><p className="fine">{e.progress_percent} % genomfört{e.valid_until ? ` · tillgänglig till ${dateOnly(e.valid_until)}` : ""}</p>
        {data.modules.map((m: any) => <div key={m.id}><p className="mod">{m.title}</p>{m.lessons.map((l: Lesson) => <button key={l.id} className="lesson-link" disabled={l.locked || !e.access_enabled} aria-current={l.id === lessonId && !showExam} onClick={() => open(l.id)}><span className={`dot ${l.status === "completed" ? "done" : l.status === "started" ? "started" : ""}`}>{l.status === "completed" ? "✓" : ""}</span><span>{l.title}<br /><span className="fine">{l.kind === "video" ? "Video" : l.kind === "quiz" ? "Kunskapstest" : "Läsning"} · {duration(l.minutes)}{l.locked ? " · låst" : ""}</span></span></button>)}</div>)}
        {finalExam && <><p className="mod">Examination</p><button className="lesson-link" disabled={!e.access_enabled} aria-current={showExam === finalExam.id} onClick={() => { setShowExam(finalExam.id); setLessonId(""); }}><span className={`dot ${finalExam.passed ? "done" : ""}`}>{finalExam.passed ? "✓" : ""}</span><span>{finalExam.title}<br /><span className="fine">{finalExam.question_count} frågor · godkänt {finalExam.pass_percent} %</span></span></button></>}
        {data.certificate && <div className="card"><span className="status ok">Intyg utfärdat</span><p className="fine">Nr {data.certificate.certificate_number}</p><button className="btn small teal" onClick={() => download(data.certificate.id)}>Ladda ner intyg (PDF)</button></div>}
      </nav>
      <div className="player-main" id="lesson-main">
        {!e.access_enabled && <p className="notice warn" role="alert">Du har inte tillgång till utbildningen just nu (väntar på betalning eller tillgången är återkallad/utgången).</p>}
        {e.status === "awaiting_identity" && <p className="notice warn" role="status">Du har klarat kraven, men din identitet måste verifieras innan intyget kan utfärdas. <Link to="/mina-sidor" className="text-link">Ange personnummer under Profil</Link> – vi verifierar det och intyget utfärdas därefter.</p>}
        {e.status === "completed" && !data.certificate && <p className="notice" role="status">Utbildningen är genomförd. Intyget skapas inom kort.</p>}
        {showExam && exam ? <ExamPanel key={exam.id} exam={exam} enrollmentId={e.id} onFinished={async () => { await load(); }} />
          : lessonId && e.access_enabled ? <LessonView key={lessonId} enrollmentId={e.id} lesson={all.find((l) => l.id === lessonId)!} quizExam={data.exams.find((x: Exam) => x.lesson_id === lessonId)} onChanged={load} next={next} onNext={() => next && open(next.id)} onExam={(id) => { setShowExam(id); }} />
          : null}
      </div>
    </div>
  );
}

function LessonView({ enrollmentId, lesson, onChanged, next, onNext, quizExam, onExam }: { enrollmentId: string; lesson: Lesson; onChanged: () => Promise<any>; next?: Lesson; onNext: () => void; quizExam?: Exam; onExam: (id: string) => void }) {
  const [content, setContent] = useState<any>(null); const [error, setError] = useState(""); const [done, setDone] = useState(lesson.status === "completed"); const [msg, setMsg] = useState("");
  useEffect(() => { learn("lesson", { enrollment_id: enrollmentId, lesson_id: lesson.id }).then(setContent).catch((e) => setError((e as ApiError).message)); }, [lesson.id]);
  if (error) return <p className="notice error" role="alert">{error}</p>;
  if (!content) return <p className="muted" role="status">Laddar lektionen…</p>;
  const rule = content.lesson.completion_rule;
  const completed = () => { setDone(true); void onChanged(); };
  return <article><p className="eyebrow">{lesson.kind === "video" ? "Videolektion" : lesson.kind === "quiz" ? "Kunskapstest" : "Lektion"}</p><h1 style={{ fontSize: "1.9rem" }}>{lesson.title}</h1>
    {content.blocks.map((b: any) => <div className="block" key={b.id}>
      {b.kind === "text" && <Markdown source={b.markdown} />}
      {b.kind === "video" && <VideoBlock enrollmentId={enrollmentId} lessonId={lesson.id} block={b} onCompleted={completed} />}
      {b.kind === "image" && <figure style={{ margin: 0 }}><img src={b.url} alt={b.alt || b.title || ""} style={{ borderRadius: 12 }} />{b.title && <figcaption className="fine">{b.title}</figcaption>}</figure>}
      {b.kind === "audio" && <><p><strong>{b.title}</strong></p><audio controls src={b.url} style={{ width: "100%" }} /></>}
      {b.kind === "document" && <a className="doc-link" href={b.url} target="_blank" rel="noopener noreferrer">📄 {b.title}</a>}
      {b.kind === "link" && <p><a className="doc-link" href={b.url} target="_blank" rel="noopener noreferrer">🔗 {b.title}</a></p>}
      {b.kind === "knowledge_check" && <KnowledgeCheck enrollmentId={enrollmentId} blockId={b.id} questions={b.questions} />}
    </div>)}
    {rule.type === "view" && !done && <div className="card"><p className="muted">När du har tagit del av innehållet kan du markera lektionen som klar{rule.min_seconds ? ` (tidigast efter ${rule.min_seconds} sekunder)` : ""}.</p><button className="btn primary" onClick={async () => { try { await learn("complete_view", { enrollment_id: enrollmentId, lesson_id: lesson.id }); setMsg(""); completed(); } catch (e) { setMsg((e as ApiError).message); } }}>Markera som klar</button>{msg && <p className="notice warn" role="status">{msg}</p>}</div>}
    {rule.type === "video_watch" && !done && <p className="notice" role="status">Lektionen blir klar när du har tittat på minst {rule.min_percent ?? 90} % av videon.</p>}
    {rule.type === "quiz_pass" && !done && quizExam && <div className="card"><p>Klara kunskapstestet för att gå vidare ({quizExam.question_count} frågor, godkänt {quizExam.pass_percent} %).</p><button className="btn primary" onClick={() => onExam(quizExam.id)}>Starta kunskapstest</button></div>}
    {done && <p className="notice ok" role="status">✓ Lektionen är klar.</p>}
    {next && (done || !lesson.required) && <button className="btn primary large" onClick={onNext}>Nästa: {next.title} →</button>}
  </article>;
}

function VideoBlock({ enrollmentId, lessonId, block, onCompleted }: { enrollmentId: string; lessonId: string; block: any; onCompleted: () => void }) {
  const ref = useRef<HTMLVideoElement>(null); const [src, setSrc] = useState(""); const [sid, setSid] = useState(""); const [resume, setResume] = useState(0); const [pct, setPct] = useState<number | null>(null); const [error, setError] = useState(""); const completedRef = useRef(false);
  useEffect(() => { let alive = true; learn("video_start", { enrollment_id: enrollmentId, lesson_id: lessonId, asset_id: block.asset_id }).then((r) => { if (!alive) return; setSrc(r.url); setSid(r.session_id); setResume(r.resume_position || 0); }).catch((e) => alive && setError((e as ApiError).message)); return () => { alive = false; }; }, [block.asset_id]);
  const beat = useCallback(async (playing: boolean) => {
    const v = ref.current; if (!v || !sid) return;
    try { const r = await learn("video_heartbeat", { session_id: sid, position: v.currentTime, playing }); if (r.percent != null) setPct(r.percent); if (r.completed && !completedRef.current) { completedRef.current = true; onCompleted(); } } catch { /* nätverksglapp: nästa hjärtslag fortsätter */ }
  }, [sid]);
  useEffect(() => { if (!sid) return; const t = setInterval(() => { const v = ref.current; if (v && !v.paused && !v.ended) void beat(true); }, 5000); const vis = () => { if (document.hidden) void beat(false); }; document.addEventListener("visibilitychange", vis); return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); void beat(false); }; }, [sid, beat]);
  if (error) return <p className="notice error" role="alert">{error}</p>;
  return <div><div className="video-wrap">{src ? <video ref={ref} src={src} controls playsInline preload="metadata" controlsList="nodownload" poster={block.poster_url || undefined} onLoadedMetadata={() => { if (ref.current && resume > 0 && resume < (ref.current.duration || 1e9) - 3) ref.current.currentTime = resume; }} onPause={() => void beat(false)} onEnded={() => void beat(false)} onContextMenu={(e) => e.preventDefault()}>
    {(block.captions ?? []).map((c: any) => <track key={c.lang} kind="subtitles" srcLang={c.lang} label={c.label} src={c.url} default={c.lang === "sv"} />)}</video> : <p style={{ color: "#fff", padding: 24 }} role="status">Förbereder video…</p>}</div>
    {pct !== null && <p className="fine" aria-live="polite">Uppföljd tittartid: {Math.round(pct)} %{block.title ? ` · ${block.title}` : ""}</p>}{!(block.captions ?? []).length && <p className="fine">Videon saknar textning.</p>}</div>;
}

function KnowledgeCheck({ enrollmentId, blockId, questions }: { enrollmentId: string; blockId: string; questions: any[] }) {
  const [sel, setSel] = useState<Record<string, string[]>>({}); const [res, setRes] = useState<Record<string, any>>({});
  const toggle = (q: any, id: string) => setSel((s) => ({ ...s, [q.id]: q.multiple ? (s[q.id]?.includes(id) ? s[q.id].filter((x) => x !== id) : [...(s[q.id] ?? []), id]) : [id] }));
  return <div className="kc"><h3>Testa dig själv</h3>{questions.map((q) => <div key={q.id}><p><strong>{q.prompt}</strong>{q.multiple && <span className="fine"> (välj flera)</span>}</p>
    {q.options.map((o: any) => { const r = res[q.id]; const cls = r ? (r.correct_option_ids.includes(o.id) ? "right" : sel[q.id]?.includes(o.id) ? "wrong" : "") : sel[q.id]?.includes(o.id) ? "sel" : ""; return <label key={o.id} className={`opt ${cls}`}><input type={q.multiple ? "checkbox" : "radio"} name={q.id} checked={!!sel[q.id]?.includes(o.id)} disabled={!!r} onChange={() => toggle(q, o.id)} />{o.label}</label>; })}
    {!res[q.id] ? <button className="btn small" disabled={!sel[q.id]?.length} onClick={async () => { const r = await learn("knowledge_check_answer", { enrollment_id: enrollmentId, block_id: blockId, question_id: q.id, option_ids: sel[q.id] }); setRes((x) => ({ ...x, [q.id]: r })); }}>Kontrollera</button> : <p className={`notice ${res[q.id].correct ? "ok" : "warn"}`} role="status">{res[q.id].correct ? "Rätt!" : "Inte riktigt."} {res[q.id].explanation}</p>}</div>)}</div>;
}

function ExamPanel({ exam, enrollmentId, onFinished }: { exam: Exam; enrollmentId: string; onFinished: () => Promise<any> }) {
  const [attempt, setAttempt] = useState<any>(null); const [i, setI] = useState(0); const [sel, setSel] = useState<Record<string, string[]>>({}); const [result, setResult] = useState<any>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [left, setLeft] = useState<number | null>(null); const [cool, setCool] = useState(exam.cooldown_seconds_left);
  useEffect(() => { if (cool <= 0) return; const t = setInterval(() => setCool((c) => Math.max(0, c - 1)), 1000); return () => clearInterval(t); }, [cool > 0]);
  useEffect(() => { if (!attempt?.expires_at) return; const t = setInterval(() => setLeft(Math.max(0, Math.round((new Date(attempt.expires_at).getTime() - Date.now()) / 1000))), 1000); return () => clearInterval(t); }, [attempt?.expires_at]);
  const start = async () => { setBusy(true); setError(""); try { const a = await learn("exam_start", { enrollment_id: enrollmentId, exam_id: exam.id }); setAttempt(a); setSel(Object.fromEntries(a.questions.map((q: any) => [q.question_id, q.selected ?? []]))); setI(0); } catch (e) { setError((e as ApiError).message); } setBusy(false); };
  const choose = async (q: any, id: string) => { const cur = sel[q.question_id] ?? []; const nextSel = q.multiple ? (cur.includes(id) ? cur.filter((x: string) => x !== id) : [...cur, id]) : [id]; setSel((s) => ({ ...s, [q.question_id]: nextSel })); try { await learn("exam_answer", { attempt_id: attempt.attempt_id, question_id: q.question_id, option_ids: nextSel }); } catch (e) { setError((e as ApiError).message); } };
  const submit = async () => { if (!confirm("Lämna in provet? Du kan inte ändra svaren efteråt.")) return; setBusy(true); try { const r = await learn("exam_submit", { attempt_id: attempt.attempt_id }); setResult(r); setAttempt(null); await onFinished(); } catch (e) { setError((e as ApiError).message); } setBusy(false); };
  if (result) return <div><h1 style={{ fontSize: "1.9rem" }}>{exam.title}</h1><div className={`notice ${result.passed ? "ok" : "warn"}`} role="status"><strong>{result.status === "expired" ? "Tiden gick ut." : result.passed ? "Godkänd!" : "Ej godkänd."}</strong> Du fick {Math.round(result.percent)} % ({result.score_points}/{result.max_points} poäng). Godkänt kräver {result.pass_percent} %.</div>
    {result.attempts_left !== null && !result.passed && <p>{result.attempts_left > 0 ? `Du har ${result.attempts_left} försök kvar.` : "Du har inga försök kvar. Kontakta oss för hjälp."}</p>}
    {result.review && <><h2>Genomgång</h2>{result.review.map((r: any, n: number) => <div className="card" key={r.question_id} style={{ margin: "10px 0" }}><p><strong>{n + 1}. {r.prompt}</strong> <span className={`status ${r.correct ? "ok" : "error"}`}>{r.correct ? "Rätt" : "Fel"}</span></p>{!r.correct && r.explanation && <p className="fine">{r.explanation}</p>}</div>)}</>}
    {!result.passed && (result.attempts_left === null || result.attempts_left > 0) && <button className="btn primary" onClick={() => { setResult(null); setCool(exam.cooldown_seconds_left); }}>Till provinformation</button>}</div>;
  if (!attempt) return <div><p className="eyebrow">{exam.kind === "final" ? "Slutprov" : "Kunskapstest"}</p><h1 style={{ fontSize: "1.9rem" }}>{exam.title}</h1>
    <ul className="check-list"><li>{exam.question_count} frågor</li><li>Godkänt från {exam.pass_percent} %</li>{exam.time_limit_seconds && <li>Tidsgräns {Math.round(exam.time_limit_seconds / 60)} minuter – tiden räknas från att du startar</li>}{exam.max_attempts && <li>Högst {exam.max_attempts} försök ({exam.attempts_left} kvar)</li>}</ul>
    {exam.passed && <p className="notice ok">Du har redan klarat provet (bästa resultat {Math.round(exam.best_percent)} %).</p>}{error && <p className="notice error" role="alert">{error}</p>}{cool > 0 && <p className="notice warn" role="status">Nästa försök är möjligt om {Math.ceil(cool / 60)} min.</p>}
    <button className="btn primary large" disabled={busy || cool > 0 || exam.attempts_left === 0} onClick={start}>{exam.attempts_used > 0 ? "Starta nytt försök" : "Starta provet"}</button></div>;
  const q = attempt.questions[i]; const answered = attempt.questions.filter((x: any) => (sel[x.question_id] ?? []).length > 0).length;
  return <div><div className="row"><p className="eyebrow" style={{ margin: 0 }}>Fråga {i + 1} av {attempt.questions.length}</p>{left !== null && <span className="timer" role="timer" aria-label="Återstående tid">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>}</div>
    <div className="progress"><i style={{ width: `${((i + 1) / attempt.questions.length) * 100}%` }} /></div>
    <h2 style={{ fontSize: "1.4rem" }}>{q.prompt}</h2>{q.image_asset_id && <ExamImage key={q.image_asset_id} attemptId={attempt.attempt_id} assetId={q.image_asset_id} />}{q.multiple && <p className="fine">Välj alla rätta alternativ.</p>}
    <div role={q.multiple ? "group" : "radiogroup"} aria-label={q.prompt}>{q.options.map((o: any) => <label key={o.id} className={`opt ${(sel[q.question_id] ?? []).includes(o.id) ? "sel" : ""}`}><input type={q.multiple ? "checkbox" : "radio"} name={q.question_id} checked={(sel[q.question_id] ?? []).includes(o.id)} onChange={() => choose(q, o.id)} />{o.label}</label>)}</div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="row" style={{ marginTop: 18 }}><button className="btn ghost" disabled={i === 0} onClick={() => setI(i - 1)}>← Föregående</button>{i < attempt.questions.length - 1 ? <button className="btn primary" onClick={() => setI(i + 1)}>Nästa →</button> : <button className="btn teal" disabled={busy} onClick={submit}>Lämna in ({answered}/{attempt.questions.length} besvarade)</button>}</div>
    <p className="fine">Dina svar sparas löpande. Obesvarade frågor räknas som fel.</p></div>;
}

function ExamImage({ attemptId, assetId }: { attemptId: string; assetId: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; learn<{ url: string }>("exam_image", { attempt_id: attemptId, asset_id: assetId }).then((r) => live && setUrl(r.url)).catch(() => live && setFailed(true)); return () => { live = false; }; }, [attemptId, assetId]);
  if (failed) return <p className="notice warn" role="status">Bilden till frågan kunde inte hämtas. Ladda om sidan.</p>;
  if (!url) return <div className="skeleton" style={{ height: 180, borderRadius: 12 }} aria-hidden="true" />;
  return <figure style={{ margin: "8px 0 16px" }}><img src={url} alt="Bild till frågan" style={{ borderRadius: 12, maxHeight: 360, maxWidth: "100%" }} /></figure>;
}
