import { ensureJournalSeed } from "../js/domain/stage.js";
import { createAccount } from "../js/domain/account.js";
import { createTrade, syncMt5Csv, findTradeByMt5Position } from "../js/domain/trade.js";
import { listTrades, getTrade } from "../js/storage/repos/trades.js";
import { renderTradeDetail } from "../js/ui/screens/trade-detail.js";
import { renderNuevoTrade } from "../js/ui/screens/trade-new.js";
import { MT5_SLICE11_ROWS, asMt5Csv } from "../js/fixtures/mt5-slice11.js";
import {
  TradeRecordSource,
  Lifecycle,
  Strategy,
  Style,
  CloseType,
  Context,
} from "../js/domain/enums.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

function flatten(nodes) {
  const host = document.createElement("div");
  host.append(...[].concat(nodes).filter(Boolean));
  return host;
}

function fill(host, name, value) {
  const node = host.querySelector(`[name="${name}"]`);
  if (!node) throw new Error("campo ausente: " + name);
  node.value = value;
  node.dispatchEvent(new Event("change", { bubbles: true }));
  return node;
}

async function run() {
  const seed = await ensureJournalSeed();
  const { stage } = seed;
  const tz = "Europe/Athens";
  const bullfy = await createAccount(
    { name: "Bullfy PROP", context: Context.PROP_CHALLENGE, currency: "USD", initialAmount: 10000 },
    stage.id,
  );
  const src = { accountId: bullfy.id, context: bullfy.context, timeZone: tz };

  const imported = await syncMt5Csv(asMt5Csv([MT5_SLICE11_ROWS.nzdjpyShort]), stage.id, src);
  assert("import MT5 NZDJPY", imported.created === 1);
  const raw = await findTradeByMt5Position(bullfy.id, "20021");
  assert("MT5 UNCLASSIFIED SHORT CLOSED", raw && raw.strategy === Strategy.UNCLASSIFIED && raw.direction === "SHORT" && raw.lifecycle === Lifecycle.CLOSED);

  const card = flatten(await renderTradeDetail({
    ...seed,
    route: { name: "trade", rest: raw.id, query: {} },
  }));
  const editBtn = [...card.querySelectorAll("button")].find((b) => b.textContent === "Editar operación");
  assert("ficha muestra Editar operación", Boolean(editBtn));
  assert("ficha muestra origen MT5", /origen MT5_EA/.test(card.textContent));
  assert("ficha no edita position", !card.querySelector('[name="sourceRef"]') && !card.querySelector('[name="recordSource"]'));

  const editor = flatten(await renderTradeDetail({
    ...seed,
    route: { name: "trade", rest: raw.id + "/editar", query: {} },
  }));
  assert("editor visible", Boolean(editor.querySelector('[name="strategy"]')) && /Editar operación/.test(editor.textContent));
  assert("editor tiene closeType porque CLOSED", Boolean(editor.querySelector('[name="closeType"]')));
  assert("editor no toca provenance", !editor.querySelector('[name="recordSource"]') && !editor.querySelector('[name="accountId"]') && !editor.querySelector('[name="brokerSymbol"]'));
  fill(editor, "strategy", Strategy.RED);
  fill(editor, "style", Style.SCALP);
  fill(editor, "closeType", CloseType.SL);
  fill(editor, "management", "Gestión test");
  fill(editor, "note", "Nota test");
  const save = [...editor.querySelectorAll("button")].find((b) => b.textContent === "Guardar cambios");
  assert("botón Guardar cambios", Boolean(save));
  save.click();
  let saved = raw;
  for (let i = 0; i < 25; i++) {
    saved = await getTrade(raw.id);
    if (saved.strategy === Strategy.RED && saved.note === "Nota test") break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert("UNCLASSIFIED → RED", saved.strategy === Strategy.RED);
  assert("SCALP persistido", saved.style === Style.SCALP);
  assert("SL persistido", saved.closeType === CloseType.SL);
  assert("management persistido", saved.management === "Gestión test");
  assert("note persistida", saved.note === "Nota test");
  assert("mismo trade id", saved.id === raw.id);
  assert("sigue CLOSED", saved.lifecycle === Lifecycle.CLOSED);
  assert("provenance MT5", saved.recordSource === TradeRecordSource.MT5_EA);
  assert("provenance position", saved.sourceRef && saved.sourceRef.mt5Position === "20021");
  assert("provenance account", saved.accountId === bullfy.id);
  assert("provenance broker", saved.brokerSymbol === "NZDJPY");

  const again = flatten(await renderTradeDetail({
    ...seed,
    route: { name: "trade", rest: raw.id, query: {} },
  }));
  assert("recarga muestra RED", /strategy RED/.test(again.textContent));
  assert("recarga muestra SCALP", /style SCALP/.test(again.textContent));
  assert("recarga muestra SL", /closeType SL/.test(again.textContent));
  assert("recarga origen intacto", /origen MT5_EA · position 20021/.test(again.textContent));

  const beforeCancel = await getTrade(raw.id);
  const editor2 = flatten(await renderTradeDetail({
    ...seed,
    route: { name: "trade", rest: raw.id + "/editar", query: {} },
  }));
  fill(editor2, "strategy", Strategy.BLUE);
  fill(editor2, "note", "no guardar");
  const cancel = [...editor2.querySelectorAll("button")].find((b) => b.textContent === "Cancelar");
  assert("botón Cancelar", Boolean(cancel));
  cancel.click();
  const afterCancel = await getTrade(raw.id);
  assert("cancel no persiste strategy", afterCancel.strategy === beforeCancel.strategy && afterCancel.strategy === Strategy.RED);
  assert("cancel no persiste note", afterCancel.note === "Nota test");

  const nBefore = (await listTrades()).length;
  const nuevoOpen = flatten(await renderNuevoTrade({
    ...seed,
    route: { name: "nuevo", rest: "trade", query: {} },
  }));
  assert("Nueva tiene Estado OPEN/CLOSED", Boolean(nuevoOpen.querySelector('[name="lifecycle"]')));
  assert("Nueva default OPEN", nuevoOpen.querySelector('[name="lifecycle"]').value === Lifecycle.OPEN);
  assert("asset es input libre", nuevoOpen.querySelector('[name="asset"]') && nuevoOpen.querySelector('[name="asset"]').tagName === "INPUT");
  assert("sugerencias no son whitelist", Boolean(nuevoOpen.querySelector("#nuevo-asset-suggest")));
  fill(nuevoOpen, "asset", "NZDJPY");
  fill(nuevoOpen, "direction", "SHORT");
  fill(nuevoOpen, "strategy", Strategy.RED);
  fill(nuevoOpen, "style", Style.SCALP);
  fill(nuevoOpen, "entry", "87.15");
  fill(nuevoOpen, "initialSL", "87.40");
  const saveOpen = [...nuevoOpen.querySelectorAll("button")].find((b) => b.textContent === "Guardar operación");
  saveOpen.click();
  let createdOpen = null;
  for (let i = 0; i < 25; i++) {
    const listed = await listTrades();
    createdOpen = listed.find((t) => t.asset === "NZDJPY" && t.lifecycle === Lifecycle.OPEN && t.recordSource === TradeRecordSource.MANUAL && t.strategy === Strategy.RED);
    if (createdOpen) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const afterOpen = await listTrades();
  assert("OPEN legacy crea 1 OPEN", Boolean(createdOpen) && afterOpen.length === nBefore + 1);
  assert("OPEN NZDJPY SHORT", createdOpen && createdOpen.asset === "NZDJPY" && createdOpen.direction === "SHORT");
  assert("OPEN nace RED no UNCLASSIFIED", createdOpen && createdOpen.strategy === Strategy.RED);
  assert("OPEN nace SCALP", createdOpen && createdOpen.style === Style.SCALP);
  assert("OPEN sigue OPEN", createdOpen && createdOpen.lifecycle === Lifecycle.OPEN);

  const nMid = afterOpen.length;
  const nuevoClosed = flatten(await renderNuevoTrade({
    ...seed,
    route: { name: "nuevo", rest: "trade", query: {} },
  }));
  fill(nuevoClosed, "lifecycle", Lifecycle.CLOSED);
  fill(nuevoClosed, "asset", "nzdjpy");
  fill(nuevoClosed, "direction", "SHORT");
  fill(nuevoClosed, "strategy", Strategy.RED);
  fill(nuevoClosed, "style", Style.SCALP);
  fill(nuevoClosed, "openedAt", "2026-09-11T09:40");
  fill(nuevoClosed, "closedAt", "2026-09-11T10:05");
  fill(nuevoClosed, "entry", "87.15");
  fill(nuevoClosed, "initialSL", "87.40");
  fill(nuevoClosed, "tp", "86.80");
  fill(nuevoClosed, "rrPlanned", "2.1");
  fill(nuevoClosed, "hasPartials", "true");
  fill(nuevoClosed, "variant", "BLUE_A");
  fill(nuevoClosed, "session", "LONDON");
  fill(nuevoClosed, "exit", "87.42");
  fill(nuevoClosed, "netPnl", "-19.2");
  fill(nuevoClosed, "commission", "0.7");
  fill(nuevoClosed, "swap", "0");
  fill(nuevoClosed, "closeType", CloseType.SL);
  fill(nuevoClosed, "management", "Gestión manual");
  fill(nuevoClosed, "note", "Nota manual");
  const saveClosed = [...nuevoClosed.querySelectorAll("button")].find((b) => b.textContent === "Guardar operación");
  saveClosed.click();
  let createdClosed = [];
  for (let i = 0; i < 25; i++) {
    const listed = await listTrades();
    createdClosed = listed.filter((t) => t.note === "Nota manual" && t.asset === "NZDJPY" && t.lifecycle === Lifecycle.CLOSED);
    if (createdClosed.length) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const afterClosed = await listTrades();
  assert("CLOSED crea una sola", createdClosed.length === 1 && afterClosed.length === nMid + 1);
  assert("NZDJPY manual aceptado", createdClosed[0].asset === "NZDJPY");
  assert("nace CLOSED", createdClosed[0].lifecycle === Lifecycle.CLOSED);
  assert("CLOSED RED SCALP SL", createdClosed[0].strategy === Strategy.RED && createdClosed[0].style === Style.SCALP && createdClosed[0].closeType === CloseType.SL);
  assert("CLOSED SHORT", createdClosed[0].direction === "SHORT");
  assert("CLOSED MANUAL", createdClosed[0].recordSource === TradeRecordSource.MANUAL);
  assert("no OPEN intermedio", createdClosed[0].openedAt && createdClosed[0].closedAt && createdClosed[0].exit === 87.42);
  assert("CLOSED initialSL", createdClosed[0].initialSL === 87.4);
  assert("CLOSED TP", createdClosed[0].tp === 86.8);
  assert("CLOSED rrPlanned", createdClosed[0].rrPlanned === 2.1);
  assert("CLOSED hasPartials", createdClosed[0].hasPartials === true);
  assert("CLOSED variant", createdClosed[0].variant === "BLUE_A");
  assert("CLOSED session", createdClosed[0].session === "LONDON");
  assert("CLOSED commission/swap", createdClosed[0].commission === 0.7 && createdClosed[0].swap === 0);

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 22\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice22 " + failed.length);
}

export { run };
