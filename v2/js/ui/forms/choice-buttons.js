import { el } from "../render.js";

// Keep the existing select as the form value; expose frequent choices as keyboard buttons.
export function choiceButtons(select, label) {
  select.hidden = true;
  const group = el("div", { className: "chips", role: "group", "aria-label": label });
  const buttons = Array.from(select.options).map(option => {
    const button = el("button", { type: "button", className: "chip", text: option.textContent, onclick: () => {
      select.value = option.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    } });
    button.dataset.value = option.value;
    return button;
  });
  function paint() {
    for (const button of buttons) {
      const selected = button.dataset.value === select.value;
      button.classList.toggle("is-on", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
  }
  select.addEventListener("change", paint);
  group.append(select, ...buttons);
  paint();
  return group;
}
