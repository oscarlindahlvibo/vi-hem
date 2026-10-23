// Enhetskontroll av AI-tolkningens rena logik (supabase/functions/_shared/ai-interpret-core.ts). Kör utan nätverk.
import assert from "node:assert/strict";
import {
  buildTransportOrderPrompt, completeness, estimateOpenAiCostSek, isUsableOrder, looksGarbled, mergeDuplicateOrders, normalizeOrders, safeJsonParse, sha256Hex,
  statusForDbError, transportOrderSchema, validateInterpretRequest,
} from "../supabase/functions/_shared/ai-interpret-core.ts";

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };
const png = Buffer.from("x".repeat(3000)).toString("base64");

check("mått i centimeter och millimeter görs om till meter", () => {
  const { orders, warnings } = normalizeOrders({ orders: [{ documentNumber: "1", items: [{ typeName: "Modul", length_m: 6.35, width_m: 395, height_m: 3400, weight_ton: 0.5 }] }] });
  assert.equal(orders[0].items[0].length_m, 6.35);
  assert.equal(orders[0].items[0].width_m, 3.95);
  assert.equal(orders[0].items[0].height_m, 3.4);
  assert.ok(warnings.length > 0);
});

check("kopior av samma fraktsedel slås ihop till en order med kompletta godsrader", () => {
  const copy = (items) => ({ documentNumber: "58806", deliveryAddress: "Väsby 34", recipientPhone: null, items });
  const { orders } = normalizeOrders({ orders: [
    copy([{ typeName: "Modul 14", quantity: 1, length_m: 6.35, width_m: 3.95, height_m: 3.4, weight_ton: 0 }, { typeName: "Modul 5", quantity: 1 }]),
    { ...copy([{ typeName: "modul 14", weight_ton: 8.2 }, { typeName: "Modul 5", length_m: 6.65, width_m: 3.35, height_m: 3.4 }]), recipientPhone: "073-0675742" },
  ] });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].recipientPhone, "073-0675742");
  assert.equal(orders[0].items.length, 2);
  assert.equal(orders[0].items[0].weight_ton, 8.2);
  assert.equal(orders[0].items[1].length_m, 6.65);
  assert.equal(mergeDuplicateOrders([{ ...orders[0], documentNumber: null }, { ...orders[0], documentNumber: null }]).length, 2);
});

check("tabellrubriker som godsrader upptäcks", () => {
  const bad = normalizeOrders({ orders: [{ documentNumber: "L1", items: [{ typeName: "Godsmärke" }, { typeName: "Koordinat" }] }] }).orders;
  const good = normalizeOrders({ orders: [{ documentNumber: "L1", items: [{ typeName: "2 dörrar", goodsMark: "H-1" }] }] }).orders;
  assert.equal(looksGarbled(bad), true);
  assert.equal(looksGarbled(good), false);
});

check("schemat är strikt och kräver alla fält", () => {
  const schema = transportOrderSchema();
  const order = schema.properties.orders.items;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(order.required.sort(), Object.keys(order.properties).sort());
  assert.ok(order.required.includes("deliveryCity") && order.required.includes("items"));
  const item = order.properties.items.items;
  assert.deepEqual(item.required.sort(), Object.keys(item.properties).sort());
});

check("normaliserar tolkningen: datum, tal, text och ogiltiga värden", () => {
  const { orders } = normalizeOrders({ orders: [{
    documentNumber: "  LTC0020553 ", deliveryCity: "Falköping", loadingDate: "2026-10-26", deliveryDate: "2026-02-31", recipientEmail: " a@b.se ",
    items: [{ quantity: "1", typeName: "Dörrar", weight_ton: "1570", length_m: -3, width_m: "1,5", height_m: null, orderRef: null, goodsMark: null, deliveryTermsAddition: null }],
  }] });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].documentNumber, "LTC0020553");
  assert.equal(orders[0].loadingDate, "2026-10-26");
  assert.equal(orders[0].deliveryDate, null); // ogiltigt datum
  assert.equal(orders[0].items[0].quantity, 1);
  assert.equal(orders[0].items[0].weight_ton, 1.57); // över 200 tolkas som kilo → ton (samma regel som JK:s textläsning)
  assert.equal(orders[0].items[0].length_m, null); // negativt värde nekas
  assert.equal(orders[0].items[0].width_m, 1.5);
  assert.equal(orders[0].recipientEmail, "a@b.se");
});

check("tomma eller oanvändbara ordrar filtreras bort", () => {
  assert.equal(normalizeOrders({ orders: [{ items: [] }, null, "x"] }).orders.length, 0);
  assert.equal(normalizeOrders({}).orders.length, 0);
  assert.equal(normalizeOrders("skräp").orders.length, 0);
  assert.equal(isUsableOrder({ documentNumber: null, deliveryCity: null, deliveryAddress: null, recipientCompany: null, items: [] }), false);
});

check("fullständighet blir högre ju fler fält som finns", () => {
  const full = normalizeOrders({ orders: [{ documentNumber: "1", loadingDate: "2026-10-01", deliveryDate: "2026-10-02", deliveryAddress: "A 1", deliveryCity: "X", recipientCompany: "K", items: [{ typeName: "a" }] }] }).orders;
  const thin = normalizeOrders({ orders: [{ documentNumber: "1" }] }).orders;
  assert.equal(completeness(full), 1);
  assert.ok(completeness(thin) < 0.3);
  assert.equal(completeness([]), 0);
});

check("begäran valideras: sidor, typer, storlek och request_id", () => {
  const ok = validateInterpretRequest({ request_id: "r1", file_name: "LTC.pdf", pages: [{ content_type: "image/png", base64: png }] }, 10);
  assert.equal(ok.ok, true);
  assert.equal(validateInterpretRequest({ pages: [{ content_type: "image/png", base64: png }] }, 10).ok, false);
  assert.equal(validateInterpretRequest({ request_id: "r", pages: [] }, 10).status, 400);
  assert.equal(validateInterpretRequest({ request_id: "r", pages: Array(11).fill({ content_type: "image/png", base64: png }) }, 10).status, 413);
  assert.equal(validateInterpretRequest({ request_id: "r", pages: [{ content_type: "application/pdf", base64: png }] }, 10).status, 415);
  assert.equal(validateInterpretRequest({ request_id: "r", pages: [{ content_type: "image/png", base64: "###" }] }, 10).status, 400);
  assert.equal(validateInterpretRequest({ request_id: "r".repeat(101), pages: [{ content_type: "image/png", base64: png }] }, 10).ok, false);
  const huge = "A".repeat(4_000_000);
  assert.equal(validateInterpretRequest({ request_id: "r", pages: [{ content_type: "image/jpeg", base64: huge }] }, 10).status, 413);
});

check("data-URL-prefix tas bort från bilddata", () => {
  const r = validateInterpretRequest({ request_id: "r", pages: [{ content_type: "image/jpeg", base64: `data:image/jpeg;base64,${png}` }] }, 10);
  assert.equal(r.ok && r.pages[0].base64, png);
});

check("databasfel översätts till rätt HTTP-status", () => {
  assert.equal(statusForDbError("28000"), 401);
  assert.equal(statusForDbError("42501"), 403);
  assert.equal(statusForDbError("54000"), 413);
  assert.equal(statusForDbError("53400"), 429);
  assert.equal(statusForDbError("22023"), 400);
  assert.equal(statusForDbError(undefined), 500);
});

check("kostnad uppskattas och prompten innehåller reglerna", () => {
  assert.ok(estimateOpenAiCostSek("gpt-5-mini", 10000, 1000) > 0);
  assert.ok(estimateOpenAiCostSek("gpt-5-nano", 10000, 1000) < estimateOpenAiCostSek("gpt-5-mini", 10000, 1000));
  assert.match(buildTransportOrderPrompt("text"), /YYYY-MM-DD/);
  assert.match(buildTransportOrderPrompt(""), /bifogas som bilder/);
  assert.deepEqual(safeJsonParse('skräp {"orders":[]} slut'), { orders: [] });
  assert.deepEqual(safeJsonParse("inte json"), {});
});

check("sha256 ger känt värde", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

console.log(`${passed} kontroller klara`);
