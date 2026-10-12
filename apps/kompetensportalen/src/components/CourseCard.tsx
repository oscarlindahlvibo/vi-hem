import type { Course } from "../lib/api";
import { FORM_LABEL, duration, money, validityLabel } from "../lib/format";
import { Link } from "../lib/router";

export function CourseCard({ course }: { course: Course }) {
  const soon = course.status === "coming_soon" || !course.product;
  return (
    <Link to={`/utbildningar/${course.slug}`} className="course-card" aria-label={course.title}>
      <div className="course-art">
        {course.image_url ? <img src={course.image_url} alt="" loading="lazy" /> : <span>{course.code}</span>}
        <div className="tags"><span className="tag">{course.delivery_form === "self_paced" ? "Online" : course.delivery_form === "instructor_led" ? "Lärarledd" : "Blandad"}</span>{course.id06_enabled && <span className="tag">ID06</span>}{soon && <span className="tag">Kommer snart</span>}</div>
      </div>
      <div className="course-body">
        <h3>{course.title}</h3>
        <p>{course.summary || course.subtitle}</p>
        <div className="course-meta"><span>{duration(course.estimated_minutes)}</span><span>{validityLabel(course.validity_months)}</span><span>{FORM_LABEL[course.delivery_form].split(" (")[0]}</span></div>
        <div className="course-foot">{course.product ? <span className="price">{money(course.product.price)} <small>exkl. moms</small></span> : <span className="muted">Pris meddelas</span>}<span className="text-link">Läs mer →</span></div>
        {course.delivery_form !== "self_paced" && course.session_count > 0 && <span className="fine">{course.session_count} kommande tillfällen</span>}
      </div>
    </Link>
  );
}
