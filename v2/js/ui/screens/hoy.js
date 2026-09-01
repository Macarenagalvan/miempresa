import { el } from "../render.js";
import { listStageTrades } from "../../domain/trade.js";
import { getActiveAccount, balanceFor } from "../../domain/account.js";
import { listStageSignals } from "../../domain/signal.js";
import { listActiveSetups } from "../../domain/setup.js";
import { REAL_CONTEXTS } from "../../domain/integrity.js";
import { Lifecycle, SetupStatus } from "../../domain/enums.js";
import { go } from "../router.js";
import { greetingLine, longDate, icon, iconBtn, ICONS } from "../identity.js";
import {
  addOfficeTask,
  updateOfficeTask,
  completeOfficeTask,
  reopenOfficeTask,
  archiveOfficeTask,
  listHoyTasks,
} from "../../domain/office-task.js";
import {
  addOfficeNote,
  updateOfficeNote,
  archiveOfficeNote,
  listHoyNotes,
} from "../../domain/office-note.js";
import { buildCalCard } from "./hoy-cal.js";
import { listHoyShortcuts } from "../../domain/office-shortcut.js";

const FOLLOW_STATUSES = [SetupStatus.WATCHING, SetupStatus.WAITING_CONFIRMATION];

function contextLabel(ctx) {
  return ctx === "PROP_CHALLENGE" ? "PROP" : ctx;
}

function localYmd(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function isLocalDay(value, day = localYmd()) {
  if (!value) return false;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value === day;
  return localYmd(value) === day;
}

function choice(title, line, path, pathIcon) {
  return el("button", { type: "button", className: "choice", onclick: () => go(path) }, [
    icon(pathIcon),
    el("strong", { text: title }),
    el("span", { text: line }),
  ]);
}

function histRow(cells, path, extraClass = "") {
  const row = el("button", { type: "button", className: "row hist" + extraClass }, cells);
  row.addEventListener("click", () => go(path));
  return row;
}

function officeCard(title, pathIcon, body, extraClass = "") {
  return el("section", { className: ("panel office-card" + (extraClass ? " " + extraClass : "")).trim() }, [
    el("h2", { className: "office-card-title" }, [
      icon(pathIcon),
      el("span", { text: title }),
    ]),
    body,
  ]);
}

function shortDue(ymd) {
  const parts = String(ymd || "").split("-").map(Number);
  if (parts.length !== 3 || !parts[0]) return "";
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
  });
}

function dueChip(task, today) {
  if (!task.dueDate) return null;
  if (task.dueDate === today) return el("span", { className: "task-chip is-today", text: "Hoy" });
  if (!task.done && task.dueDate < today) return el("span", { className: "task-chip is-late", text: "Atrasada" });
  return el("span", { className: "task-chip", text: shortDue(task.dueDate) });
}

function ghostBtn(label, className, onClick) {
  const btn = el("button", { type: "button", className: "ghost task-mini " + className, text: label });
  btn.addEventListener("click", onClick);
  return btn;
}

async function refreshTasksCard(ctx, node) {
  const card = node.closest(".office-tasks");
  if (!card) return;
  card.replaceWith(await buildTasksCard(ctx));
}

function taskRow(task, ctx, today) {
  const row = el("div", { className: "task-row" + (task.done ? " is-done" : "") });
  const box = el("input", { type: "checkbox", className: "task-check" });
  box.checked = task.done;
  box.addEventListener("change", async () => {
    try {
      if (box.checked) await completeOfficeTask(task.id);
      else await reopenOfficeTask(task.id);
      await refreshTasksCard(ctx, row);
    } catch (err) {
      box.checked = task.done;
      const host = row.closest(".office-tasks");
      if (host) {
        const errEl = host.querySelector(".task-err");
        if (errEl) errEl.textContent = err.message;
      }
    }
  });

  function showEdit() {
    const textField = el("input", { className: "input task-edit-text", type: "text", value: task.text });
    const dateField = el("input", { className: "input slim task-edit-due", type: "date" });
    if (task.dueDate) dateField.value = task.dueDate;
    const save = ghostBtn("Guardar", "task-save", async () => {
      try {
        await updateOfficeTask(task.id, { text: textField.value, dueDate: dateField.value || null });
        await refreshTasksCard(ctx, row);
      } catch (err) {
        const host = row.closest(".office-tasks");
        if (host) {
          const errEl = host.querySelector(".task-err");
          if (errEl) errEl.textContent = err.message;
        }
      }
    });
    const cancel = ghostBtn("Cancelar", "task-cancel", async () => {
      await refreshTasksCard(ctx, row);
    });
    row.replaceChildren(
      el("div", { className: "task-edit" }, [textField, dateField, save, cancel]),
    );
    textField.focus();
    textField.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        save.click();
      }
    });
  }

  const main = el("div", { className: "task-main" }, [
    el("p", { className: "task-text", text: task.text }),
    dueChip(task, today),
  ]);
  const actions = el("div", { className: "task-actions" }, [
    iconBtn("Editar", "task-edit-btn", ICONS.edit, showEdit),
    iconBtn("Archivar", "task-archive-btn", ICONS.archive, async () => {
      await archiveOfficeTask(task.id);
      await refreshTasksCard(ctx, row);
    }),
  ]);
  row.append(box, main, actions);
  return row;
}

async function buildTasksCard(ctx) {
  const { pending, doneToday, today } = await listHoyTasks();
  const err = el("p", { className: "err task-err", text: "" });
  const textInput = el("input", {
    className: "input task-input",
    type: "text",
    placeholder: "¿Qué tenés pendiente?",
    autocomplete: "off",
  });
  const dateInput = el("input", { className: "input slim task-due", type: "date" });
  const addBtn = el("button", { type: "button", className: "ghost task-add", text: "Agregar" });

  async function submit() {
    err.textContent = "";
    const text = textInput.value;
    try {
      await addOfficeTask({ text, dueDate: dateInput.value || null });
      textInput.value = "";
      dateInput.value = "";
      await refreshTasksCard(ctx, addBtn);
    } catch (e) {
      err.textContent = e.message;
    }
  }
  addBtn.addEventListener("click", submit);
  textInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      submit();
    }
  });

  const composer = el("div", { className: "task-composer" }, [textInput, dateInput, addBtn]);
  const list = el("div", { className: "task-list" }, pending.map((task) => taskRow(task, ctx, today)));
  const empty = pending.length
    ? null
    : el("p", { className: "empty office-empty", text: "No tenés tareas pendientes." });

  let doneBlock = null;
  if (doneToday.length) {
    const body = el("div", { className: "task-done-list" }, doneToday.map((task) => taskRow(task, ctx, today)));
    const wrap = el("details", { className: "task-done" });
    wrap.open = true;
    wrap.append(
      el("summary", { text: "Completadas hoy (" + doneToday.length + ")" }),
      body,
    );
    doneBlock = wrap;
  }

  return officeCard("Tareas", ICONS.task, el("div", { className: "task-panel" }, [
    composer,
    err,
    empty,
    list,
    doneBlock,
  ]), "office-tasks");
}

async function refreshNotesCard(ctx, node) {
  const card = node.closest(".office-notes");
  if (!card) return;
  card.replaceWith(await buildNotesCard(ctx));
}

function notePaper(note, ctx) {
  const card = el("article", { className: "note-paper" });

  function showEdit() {
    const field = el("textarea", { className: "input note-edit-text", rows: "3" });
    field.value = note.text;
    const save = ghostBtn("Guardar", "note-save", async () => {
      try {
        await updateOfficeNote(note.id, { text: field.value });
        await refreshNotesCard(ctx, card);
      } catch (err) {
        const host = card.closest(".office-notes");
        if (host) {
          const errEl = host.querySelector(".note-err");
          if (errEl) errEl.textContent = err.message;
        }
      }
    });
    const cancel = ghostBtn("Cancelar", "note-cancel", async () => {
      await refreshNotesCard(ctx, card);
    });
    field.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        save.click();
      }
    });
    card.replaceChildren(el("div", { className: "note-edit" }, [field, save, cancel]));
    field.focus();
  }

  card.append(
    el("p", { className: "note-text", text: note.text }),
    el("div", { className: "note-actions" }, [
      iconBtn("Editar", "note-edit-btn", ICONS.edit, showEdit),
      iconBtn("Archivar", "note-archive-btn", ICONS.archive, async () => {
        await archiveOfficeNote(note.id);
        await refreshNotesCard(ctx, card);
      }),
    ]),
  );
  return card;
}

async function buildNotesCard(ctx) {
  const notes = await listHoyNotes();
  const err = el("p", { className: "err note-err", text: "" });
  const field = el("textarea", {
    className: "input note-input",
    rows: "2",
    placeholder: "Anotá algo para no olvidarte…",
  });
  const addBtn = el("button", { type: "button", className: "ghost note-add", text: "Guardar" });

  async function submit() {
    err.textContent = "";
    try {
      await addOfficeNote({ text: field.value });
      field.value = "";
      await refreshNotesCard(ctx, addBtn);
    } catch (e) {
      err.textContent = e.message;
    }
  }
  addBtn.addEventListener("click", submit);
  field.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      submit();
    }
  });

  const composer = el("div", { className: "note-composer" }, [field, addBtn]);
  const grid = el("div", { className: "note-grid" }, notes.map((note) => notePaper(note, ctx)));
  const empty = notes.length
    ? null
    : el("p", { className: "empty office-empty", text: "Nada anotado por ahora." });

  return officeCard("No olvidar", ICONS.pin, el("div", { className: "note-panel" }, [
    composer,
    err,
    empty,
    grid,
  ]), "office-notes");
}

export async function renderHoy(ctx) {
  const stageName = ctx.stage ? ctx.stage.name : "-";
  const today = localYmd();
  const trades = await listStageTrades(ctx.stage.id, { includeVoid: false });
  const real = trades.filter((t) => REAL_CONTEXTS.includes(t.context));
  const open = real.filter((t) => t.lifecycle === Lifecycle.OPEN);
  const closedToday = real.filter((t) => t.lifecycle === Lifecycle.CLOSED && isLocalDay(t.closedAt, today));
  const active = await getActiveAccount();
  const ideas = (await listActiveSetups(ctx.stage.id))
    .filter((s) => FOLLOW_STATUSES.includes(s.status));
  const signalsToday = (await listStageSignals(ctx.stage.id))
    .filter((s) => isLocalDay(s.printedAt, today));

  let accountBlock = null;
  if (active) {
    const bal = await balanceFor(active.id);
    accountBlock = el("p", {
      className: "meta num",
      text: active.name + " · " + contextLabel(active.context) + " · " + bal + " " + active.currency,
    });
  }

  const openList = open.length
    ? open.map((t) => histRow([
      el("strong", { text: t.asset }),
      el("span", { text: contextLabel(t.context) }),
      el("span", { text: t.direction }),
      el("span", { className: "num", text: String(t.entry) }),
    ], "trade/" + t.id, " is-open"))
    : [
      el("div", { className: "empty-block" }, [
        el("p", { className: "empty", text: "No hay operaciones Real abiertas." }),
        el("p", { className: "hint", text: "El escritorio sigue acá." }),
      ]),
    ];

  const closedList = closedToday.map((t) => {
    const tone = t.result === "WIN" ? " is-win" : t.result === "LOSS" ? " is-loss" : t.result === "BE" ? " is-be" : "";
    return histRow([
      el("strong", { text: t.asset }),
      el("span", { text: contextLabel(t.context) }),
      el("span", { text: t.result || "-" }),
      el("span", { className: "num", text: t.netPnl == null ? "-" : String(t.netPnl) }),
    ], "trade/" + t.id, tone);
  });

  const ideaList = ideas.map((s) => histRow([
    el("strong", { text: s.asset }),
    el("span", { text: s.direction }),
    el("span", { text: s.status === SetupStatus.WAITING_CONFIRMATION ? "esperando" : "siguiendo" }),
  ], "setup/" + s.id));

  const signalList = signalsToday.map((s) => histRow([
    el("strong", { text: s.asset }),
    el("span", { text: s.direction }),
    el("span", { text: s.disposition || "-" }),
  ], "senal/" + s.id));

  const tradingBlocks = [
    el("h2", { text: "Abiertas" }),
    el("div", { className: "list table-wrap" }, openList),
    closedToday.length ? el("h2", { text: "Cierres de hoy" }) : null,
    closedToday.length ? el("div", { className: "list table-wrap" }, closedList) : null,
    ideas.length ? el("h2", { text: "Ideas en seguimiento" }) : null,
    ideas.length ? el("div", { className: "list table-wrap" }, ideaList) : null,
    signalsToday.length ? el("h2", { text: "Señales de hoy" }) : null,
    signalsToday.length ? el("div", { className: "list table-wrap" }, signalList) : null,
  ];

  return [
    el("div", { className: "hoy-desk" }, [
      el("section", { className: "panel identity-band hoy-ident" }, [
        el("p", { className: "kicker", text: "Trading Office" }),
        el("h1", { text: greetingLine(ctx.meta) }),
        el("p", { className: "meta", text: longDate() + " · Etapa " + stageName }),
        accountBlock,
      ]),
      el("section", { className: "panel hoy-actions" }, [
        el("h2", { className: "hoy-col-title", text: "Registrar" }),
        el("div", { className: "choice-grid hoy-capture" }, [
          choice("Nota", "Algo que vi o aprendí.", "nuevo/observacion", ICONS.note),
          choice("Idea", "Una oportunidad que estoy siguiendo.", "nuevo/setup", ICONS.idea),
          choice("Operación", "Un trade que ejecuté o quiero registrar.", "nuevo/trade", ICONS.trade),
        ]),
      ]),
      el("section", { className: "panel hoy-trading" }, [
        el("h2", { className: "hoy-col-title", text: "Trading Hoy" }),
        ...tradingBlocks,
      ]),
      el("div", { className: "hoy-day" }, [
        el("h2", { className: "hoy-col-title day-label", text: "Mi Día" }),
        await buildTasksCard(ctx),
        await buildNotesCard(ctx),
        await buildCalCard(ctx),
        await buildShortcutsCard(ctx),
      ]),
    ]),
  ];
}

function emptyShell(copy) {
  return el("p", { className: "empty office-empty", text: copy });
}

function shortcutChip(item) {
  const link = el("a", {
    className: "shortcut-chip",
    href: item.url,
    target: "_blank",
    rel: "noopener noreferrer",
  }, [
    icon(ICONS.link),
    el("span", { text: item.label }),
  ]);
  return link;
}

async function buildShortcutsCard() {
  const items = await listHoyShortcuts();
  const configure = el("button", { type: "button", className: "ghost task-mini shortcut-config", text: "Configurar" });
  configure.addEventListener("click", () => go("sistema"));
  const chips = items.length
    ? el("div", { className: "shortcut-row" }, items.map(shortcutChip))
    : emptyShell("Todavía no configuraste accesos rápidos.");
  return officeCard("Accesos rápidos", ICONS.link, el("div", { className: "shortcut-panel" }, [
    chips,
    configure,
  ]), "office-shortcuts");
}
