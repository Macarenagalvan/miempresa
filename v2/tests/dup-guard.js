// El journal pregunta antes de guardar algo que parece repetido.
// En las pruebas de formularios se acepta automáticamente («Guardar igual») y se cuenta cada aviso.
export function autoAcceptDuplicates() {
  const guard = { count: 0 };
  const scan = () => {
    for (const dialog of document.querySelectorAll("dialog.rgm-dialog")) {
      const accept = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Guardar igual");
      if (accept && !dialog.dataset.autoAccepted) { dialog.dataset.autoAccepted = "1"; guard.count += 1; accept.click(); }
    }
  };
  guard.observer = new MutationObserver(scan);
  guard.observer.observe(document.body, { childList: true, subtree: true });
  guard.stop = () => guard.observer.disconnect();
  return guard;
}
