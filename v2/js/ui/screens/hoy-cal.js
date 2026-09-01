import { el } from "../render.js";
import { icon, ICONS } from "../identity.js";
import {
  addOfficeEvent,
  updateOfficeEvent,
  archiveOfficeEvent,
  listEventsOnDate,
  listMonthEventDates,
} from "../../domain/office-event.js";

const calView = { year: null, month: null, selected: null };

function localYmd(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
}

function officeCard(title, pathIcon, body, extraClass = "") {
  return el("section", { className: ("panel office-card" + (extraClass ? " " + extraClass : "")).trim() }, [
    el("h2", { className: "office-card-title" }, [icon(pathIcon), el("span", { text: title })]),
    body,
  ]);
}

function ghostBtn(label, className, onClick) {
  const btn = el("button", { type: "button", className: "ghost task-mini " + className, text: label });
  btn.addEventListener("click", onClick);
  return btn;
}

function ymdFromParts(year, monthIndex, day) {
  return year + "-" + String(monthIndex + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

function ensureCalView(todayYmd) {
  if (!calView.selected) {
    calView.selected = todayYmd;
    const parts = todayYmd.split("-").map(Number);
    calView.year = parts[0];
    calView.month = parts[1] - 1;
  }
}

function shiftCalMonth(delta, todayYmd) {
  ensureCalView(todayYmd);
  const dt = new Date(calView.year, calView.month + delta, 1);
  calView.year = dt.getFullYear();
  calView.month = dt.getMonth();
  const sel = calView.selected || todayYmd;
  const selParts = sel.split("-").map(Number);
  if (selParts[0] !== calView.year || selParts[1] - 1 !== calView.month) {
    calView.selected = ymdFromParts(calView.year, calView.month, 1);
  }
}

function agendaLabel(ymd, todayYmd) {
  if (ymd === todayYmd) return "Agenda de hoy";
  const parts = String(ymd || "").split("-").map(Number);
  if (parts.length !== 3 || !parts[0]) return ymd;
  const raw = new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long",
  });
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : ymd;
}

function monthTitle(year, monthIndex) {
  const raw = new Date(year, monthIndex, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : (year + "-" + String(monthIndex + 1));
}

async function refreshCalCard(ctx, node) {
  const card = node.closest(".office-cal");
  if (!card) return;
  card.replaceWith(await buildCalCard(ctx));
}

function eventRow(ev, ctx) {
  const row = el("div", { className: "cal-event" });
  function showEdit() {
    const titleField = el("input", { className: "input cal-edit-title", type: "text", value: ev.title });
    const dateField = el("input", { className: "input slim cal-edit-date", type: "date" });
    dateField.value = ev.date;
    const timeField = el("input", { className: "input slim cal-edit-time", type: "time" });
    if (ev.time) timeField.value = ev.time;
    const noteField = el("input", { className: "input cal-edit-note", type: "text", value: ev.note || "" });
    noteField.setAttribute("placeholder", "Nota (opcional)");
    const save = ghostBtn("Guardar", "cal-save", async () => {
      try {
        const next = await updateOfficeEvent(ev.id, {
          title: titleField.value, date: dateField.value, time: timeField.value || null, note: noteField.value,
        });
        if (next.date) calView.selected = next.date;
        await refreshCalCard(ctx, row);
      } catch (err) {
        const host = row.closest(".office-cal");
        if (host) {
          const errEl = host.querySelector(".cal-err");
          if (errEl) errEl.textContent = err.message;
        }
      }
    });
    const cancel = ghostBtn("Cancelar", "cal-cancel", async () => { await refreshCalCard(ctx, row); });
    row.replaceChildren(el("div", { className: "cal-edit" }, [titleField, dateField, timeField, noteField, save, cancel]));
    titleField.focus();
  }
  row.append(
    el("p", { className: "cal-event-line" }, [
      el("span", { className: "cal-event-time", text: ev.time || "—" }),
      el("span", { className: "cal-event-dot", text: "·" }),
      el("span", { className: "cal-event-title", text: ev.title }),
    ]),
    ev.note ? el("p", { className: "cal-event-note", text: ev.note }) : null,
    el("div", { className: "cal-event-actions" }, [
      ghostBtn("Editar", "cal-edit-btn", showEdit),
      ghostBtn("Archivar", "cal-archive-btn", async () => {
        await archiveOfficeEvent(ev.id);
        await refreshCalCard(ctx, row);
      }),
    ]),
  );
  return row;
}

export async function buildCalCard(ctx) {
  const todayYmd = localYmd();
  ensureCalView(todayYmd);
  const year = calView.year;
  const month = calView.month;
  const selected = calView.selected;
  const marked = await listMonthEventDates(year, month);
  const agenda = await listEventsOnDate(selected);
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const lastDate = new Date(year, month + 1, 0).getDate();
  const heads = ["L", "M", "M", "J", "V", "S", "D"].map((d) => el("span", { className: "cal-dow", text: d }));
  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(el("span", { className: "cal-day is-pad", text: "" }));
  for (let day = 1; day <= lastDate; day += 1) {
    const ymd = ymdFromParts(year, month, day);
    const classes = ["cal-day"];
    if (ymd === todayYmd) classes.push("is-today");
    if (ymd === selected) classes.push("is-selected");
    if (marked.has(ymd)) classes.push("has-event");
    const btn = el("button", { type: "button", className: classes.join(" "), text: String(day) });
    btn.setAttribute("data-ymd", ymd);
    btn.addEventListener("click", async () => { calView.selected = ymd; await refreshCalCard(ctx, btn); });
    cells.push(btn);
  }
  const prev = el("button", { type: "button", className: "ghost cal-nav-btn", text: "‹" });
  prev.setAttribute("aria-label", "Mes anterior");
  prev.addEventListener("click", async () => { shiftCalMonth(-1, todayYmd); await refreshCalCard(ctx, prev); });
  const next = el("button", { type: "button", className: "ghost cal-nav-btn", text: "›" });
  next.setAttribute("aria-label", "Mes siguiente");
  next.addEventListener("click", async () => { shiftCalMonth(1, todayYmd); await refreshCalCard(ctx, next); });
  const jumpToday = el("button", { type: "button", className: "ghost cal-today-btn", text: "Hoy" });
  jumpToday.addEventListener("click", async () => {
    const parts = todayYmd.split("-").map(Number);
    calView.year = parts[0];
    calView.month = parts[1] - 1;
    calView.selected = todayYmd;
    await refreshCalCard(ctx, jumpToday);
  });
  const monthBlock = el("div", { className: "cal-month" }, [
    el("div", { className: "cal-nav" }, [
      prev, el("p", { className: "cal-title", text: monthTitle(year, month) }), next, jumpToday,
    ]),
    el("div", { className: "cal-grid" }, heads.concat(cells)),
  ]);
  const err = el("p", { className: "err cal-err", text: "" });
  const titleInput = el("input", { className: "input cal-title-input", type: "text", placeholder: "Qué / título", autocomplete: "off" });
  const timeInput = el("input", { className: "input slim cal-time-input", type: "time" });
  const noteInput = el("input", { className: "input cal-note-input", type: "text", placeholder: "Nota (opcional)", autocomplete: "off" });
  const addBtn = el("button", { type: "button", className: "ghost cal-add", text: "Guardar" });
  async function submit() {
    err.textContent = "";
    try {
      await addOfficeEvent({ title: titleInput.value, date: selected, time: timeInput.value || null, note: noteInput.value });
      titleInput.value = ""; timeInput.value = ""; noteInput.value = "";
      await refreshCalCard(ctx, addBtn);
    } catch (e) { err.textContent = e.message; }
  }
  addBtn.addEventListener("click", submit);
  titleInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); submit(); } });
  const emptyCopy = selected === todayYmd ? "No tenés nada agendado para hoy." : "No tenés nada agendado para este día.";
  const list = el("div", { className: "cal-agenda-list" }, agenda.map((ev) => eventRow(ev, ctx)));
  const empty = agenda.length ? null : el("p", { className: "empty office-empty", text: emptyCopy });
  const agendaBlock = el("div", { className: "cal-agenda" }, [
    el("p", { className: "cal-agenda-title", text: agendaLabel(selected, todayYmd) }),
    empty, list,
    el("div", { className: "cal-composer" }, [titleInput, timeInput, noteInput, addBtn]),
    err,
  ]);
  return officeCard("Calendario", ICONS.cal, el("div", { className: "cal-panel" }, [monthBlock, agendaBlock]), "office-cal");
}
