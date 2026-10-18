import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const originalCore = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      compile(
        fs.readFileSync(
          "supabase/functions/_shared/shortstay-auto-message.ts",
          "utf8",
        ),
      ),
    ).toString("base64")
);
const languageCore = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      compile(
        fs.readFileSync(
          "supabase/functions/_shared/shortstay-language.ts",
          "utf8",
        ),
      ),
    ).toString("base64")
);
const core = { ...originalCore, ...languageCore };
const translations = {
  sv: "Hej [FIRST_NAME]",
  en: "Hi [FIRST_NAME]",
  de: "Hallo [FIRST_NAME]",
  no: "Hei",
  "en-GB": "Hello",
};
const pick = (booking, mode = "auto", fallback = "en", texts = translations) =>
  core.chooseGuestMessageLanguage(texts, fallback, booking, mode);
assert.deepEqual(pick({ country2: "SE" }), {
  language: "sv",
  source: "country",
});
assert.equal(pick({ country: "Sweden" }).language, "sv");
assert.equal(pick({ country2: " de " }).language, "de");
assert.equal(pick({ lang: "EN_gb", country2: "SE" }).language, "en-GB");
assert.equal(pick({ lang: "sv-SE", country2: "GB" }).language, "sv");
assert.equal(pick({ lang: "nb-NO" }).language, "no");
assert.deepEqual(pick({ lang: "fr", country2: "SE" }), {
  language: "en",
  source: "fallback",
});
assert.equal(
  pick({ country2: "DE" }, "auto", "en", { en: "Hi", sv: "Hej" }).language,
  "en",
);
for (const country2 of ["", "ZZ", "CH", "BE", "CA"])
  assert.equal(pick({ country2 }).source, "fallback");
assert.equal(pick({ country2: "SE" }, "fixed").language, "en");
assert.equal(
  pick({ lang: "sv" }, "auto", "en", { en: "Hi", sv: "  " }).language,
  "en",
);
assert.throws(() => pick({}, "auto", "de", { en: "Hi" }), /reservspråk/);
const rule = {
  event: "arrival",
  days_offset: 0,
  send_time: "10:00",
  channels: ["booking", "expedia"],
  language: "en",
  activated_at: "2026-01-01",
};
assert(
  core.dueToday(
    rule,
    { start_date: "2026-10-18" },
    new Date("2026-10-18T08:30:00Z"),
  ),
);
assert(
  !core.dueToday(
    rule,
    { start_date: "2026-10-18" },
    new Date("2026-10-18T07:59:00Z"),
  ),
);
assert(
  !core.dueToday(
    rule,
    { start_date: "2026-10-18" },
    new Date("2026-10-18T10:00:00Z"),
  ),
);
assert(
  core.dueToday(
    { ...rule, send_time: "23:30" },
    { start_date: "2026-10-17" },
    new Date("2026-10-17T22:15:00Z"),
  ),
);
assert(
  core.dueToday(
    { ...rule, days_offset: -1 },
    { start_date: "2026-10-19" },
    new Date("2026-10-18T08:05:00Z"),
  ),
);
assert(
  core.dueToday(
    { ...rule, event: "departure", days_offset: 1 },
    { start_date: "2026-10-01", end_date: "2026-10-17" },
    new Date("2026-10-18T08:05:00Z"),
  ),
);
assert.equal(core.swedishNow(new Date("2026-10-25T01:30:00Z")).minute, 150);
assert.equal(
  core.automaticText("Hej [FIRST_NAME] [first_name]", "Anna-Lena Andersson"),
  "Hej Anna-Lena Anna-Lena",
);
assert.throws(() => core.automaticText("[FIRST_NAME]", ""), /saknas/);
assert.throws(() => core.automaticText("", "Anna"), /längd/);
const local = {
    beds24_booking_id: "123",
    start_date: "2026-10-18",
    end_date: "2026-10-20",
  },
  unit = { beds24_room_id: "1", beds24_property_id: "2" };
const live = {
  id: 123,
  roomId: 1,
  propertyId: 2,
  status: "confirmed",
  arrival: local.start_date,
  departure: local.end_date,
  channel: "booking",
};
assert(core.providerMatches(live, local, unit, rule));
for (const change of [
  { status: "cancelled" },
  { status: "new" },
  { roomId: 9 },
  { propertyId: 9 },
  { channel: "airbnb" },
  { arrival: "2026-10-19" },
])
  assert(!core.providerMatches({ ...live, ...change }, local, unit, rule));
const code = compile(
  fs.readFileSync(
    "supabase/functions/vihem-auto-guest-messages/index.ts",
    "utf8",
  ),
)
  .replace(/^import[\s\S]*?;\s*/gm, "")
  .replace(/^export \{\};?$/gm, "");
let handler,
  posts,
  claims,
  job,
  receiptError,
  channel,
  providerStatus,
  ruleEnabled,
  mirrorFail,
  dataRule,
  guestFields,
  sentText,
  templateTranslations;
const dueDate = new Date(Date.now() - 60000),
  clock = core.swedishNow(dueDate),
  send_time = `${Math.floor(clock.minute / 60)
    .toString()
    .padStart(2, "0")}:${(clock.minute % 60).toString().padStart(2, "0")}`;
const booking = {
  id: "local",
  beds24_booking_id: "123",
  start_date: clock.day,
  end_date: core.dayShift(clock.day, 2),
};
const reset = () => {
  guestFields = {};
  sentText = "";
  templateTranslations = { en: "Hi [FIRST_NAME]", sv: "Hej [FIRST_NAME]" };
  posts = 0;
  claims = 0;
  job = null;
  receiptError = false;
  channel = "booking";
  providerStatus = "confirmed";
  ruleEnabled = true;
  mirrorFail = false;
  dataRule = {
    ...rule,
    id: "rule",
    organisation_id: "org",
    unit_id: "unit",
    template_id: "template",
    revision: 1,
    enabled: true,
    send_time,
  };
};
reset();
const db = {
  async rpc(name) {
    if (name === "is_short_stay_enabled") return { data: true };
    claims++;
    if (job) return { data: null };
    job = { id: "job", beds24_booking_id: "123", status: "pending" };
    return { data: "job" };
  },
  from(table) {
    let mutation = null,
      select = "";
    const chain = {
      select(value) {
        select = value;
        return this;
      },
      update(value) {
        mutation = value;
        return this;
      },
      upsert() {
        return Promise.resolve({ error: null });
      },
      then(resolve) {
        let data;
        if (mutation) {
          if (table === "vihem_guest_message_rules")
            Object.assign(dataRule, mutation);
          if (table === "vihem_guest_message_jobs")
            Object.assign(job, mutation);
          return Promise.resolve({
            error:
              table === "vihem_short_stay_message_sends" && receiptError
                ? { message: "QA write failure" }
                : null,
          }).then(resolve);
        }
        if (table === "vihem_system_settings")
          data = { value: { enabled: true, secret: "qa-secret" } };
        else if (table === "vihem_guest_message_rules")
          data =
            select === "enabled,revision"
              ? { enabled: ruleEnabled, revision: 1 }
              : [dataRule];
        else if (table === "vihem_profiles")
          data = { active: true, role: "admin" };
        else if (table === "vihem_short_stay_message_templates")
          data = {
            translations: templateTranslations,
            updated_at: "2026-01-01",
          };
        else if (table === "vihem_short_stay_units")
          data = { id: "unit", beds24_enabled: true, ...unit };
        else if (table === "vihem_short_stay_bookings") data = [booking];
        else if (table === "vihem_guest_message_jobs") data = job ? [job] : [];
        else if (table === "vihem_beds24_connections")
          data = {
            id: "conn",
            access_token: "qa-token",
            refresh_token: "qa-refresh",
            access_token_expires_at: "2099-01-01",
          };
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    for (const method of [
      "eq",
      "in",
      "not",
      "gte",
      "lte",
      "order",
      "limit",
      "single",
      "maybeSingle",
    ])
      chain[method] = () => chain;
    return chain;
  },
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status });
new Function(
  "createClient",
  "json",
  "errorJson",
  "acceptsChannelMessages",
  "sendGuestMessage",
  "normalizeGuestMessage",
  ...Object.keys(core),
  "Deno",
  "fetch",
  code,
)(
  () => db,
  json,
  (c, m, s) => json({ error: c }, s),
  (b) => ["booking", "expedia", "airbnb", "vrbo"].includes(b.channel),
  async (...args) => {
    sentText = JSON.stringify(args);
    posts++;
    return "sent";
  },
  () => null,
  ...Object.values(core),
  { env: { get: () => "qa" }, serve: (fn) => (handler = fn) },
  async (url) => {
    if (url.includes("/bookings/messages")) {
      if (mirrorFail) throw Error("QA mirror failed");
      return json({ data: [] });
    }
    return json({
      data: [
        {
          ...live,
          ...guestFields,
          ...booking,
          id: 123,
          arrival: booking.start_date,
          departure: booking.end_date,
          channel,
          status: providerStatus,
          firstName: "Anna",
          lastName: "Andersson",
        },
      ],
    });
  },
);
const request = (secret) =>
  new Request("https://qa.invalid", {
    method: "POST",
    headers: { "x-vihem-sync-secret": secret || "qa-secret" },
    body: "{}",
  });
assert.equal((await handler(request("wrong"))).status, 401);
assert.equal(posts, 0);
for (const invalid of ["airbnb", "vrbo", "direct"]) {
  reset();
  channel = invalid;
  await handler(request());
  assert.equal(posts, 0);
  assert.equal(claims, 0);
}
reset();
providerStatus = "cancelled";
await handler(request());
assert.equal(posts, 0);
reset();
await handler(request());
assert.equal(posts, 1);
assert.equal(job.status, "sent");
await handler(request());
assert.equal(posts, 1, "A second scheduler run cannot repeat the send");
reset();
ruleEnabled = false;
await handler(request());
assert.equal(posts, 0);
assert.equal(job.status, "skipped");
reset();
receiptError = true;
await handler(request());
assert.equal(posts, 1);
assert.equal(job.status, "pending");
await handler(request());
assert.equal(posts, 1, "Lost receipt must not cause a duplicate delivery");
reset();
mirrorFail = true;
await handler(request());
assert.equal(posts, 1);
assert.equal(job.status, "sent");
await handler(request());
assert.equal(posts, 1);
console.log(
  "PASS automatic messages: Swedish dates/offsets/midnight/DST, names, live booking/channel/property/cancellation checks, scheduler secret, claim-before-POST, pause, lost receipt and mirror safety; no real transports.",
);

for (const [fields, expected] of [
  [{ country2: "SE" }, "Hej Anna"],
  [{ lang: "en", country2: "SE" }, "Hi Anna"],
  [{ lang: "fr", country2: "SE" }, "Hi Anna"],
  [{ country2: "DE" }, "Hi Anna"],
  [{}, "Hi Anna"],
]) {
  reset();
  dataRule.language_mode = "auto";
  guestFields = fields;
  await handler(request());
  assert.equal(posts, 1);
  assert(sentText.includes(expected), sentText);
}
reset();
guestFields = { country2: "SE" };
await handler(request());
assert(sentText.includes("Hi Anna"), "Existing rules stay fixed language");
reset();
dataRule.language_mode = "auto";
templateTranslations = { sv: "Hej" };
await handler(request());
assert.equal(posts, 0);
assert.equal(claims, 0);
console.log(
  "PASS automatic language: explicit language, country, missing/unsupported translation, regional locales, ambiguous country, fixed-rule compatibility, missing fallback fails closed; mock transports only.",
);
