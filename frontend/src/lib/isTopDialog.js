/* Escape and Tab belong to the top-most dialog only — these overlays stack and each registers its
   own document-level key handler, so without this one Escape collapses the whole stack.

   The population is `aria-modal`, not `role` alone: `ConsumerLayout` renders the cookie bar, the
   install prompt and the help assistant after the outlet as non-modal dialogs. `[inert]` then drops
   the two drawers that stay mounted while closed. */
export default function isTopDialog(panel) {
  const open = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
    .filter((el) => !el.closest('[inert]'));
  return !open.length || open[open.length - 1] === panel;
}
