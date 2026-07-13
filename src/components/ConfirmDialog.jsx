// Generic confirm/cancel modal, token-styled (no native window.confirm - that
// can't be restyled and looks like a browser chrome dialog, not part of the
// app). Matches Figma's "DeleteCard" (node 427:32757): a PlaceCard-style
// container with two equal-width pill buttons, ghost for Cancel and outline
// for confirm - no red/danger treatment, that's a deliberate design choice
// in the source file, not an oversight. First use: Comparison view's
// "Delete itinerary". Written as a shared component since any other
// confirm-before-you-act action can reuse it rather than each screen
// rolling its own.
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  if (!open) return null

  return (
    <div className="confirm-dialog-overlay" role="presentation" onClick={onCancel}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? 'confirm-dialog-description' : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog__body">
          <h2 className="confirm-dialog__title" id="confirm-dialog-title">
            {title}
          </h2>
          {description && (
            <p className="confirm-dialog__description" id="confirm-dialog-description">
              {description}
            </p>
          )}
        </div>
        <div className="confirm-dialog__actions">
          <button type="button" className="pill-button pill-button--ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="pill-button pill-button--outline" onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
