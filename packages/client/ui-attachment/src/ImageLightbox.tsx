import { IconCloseOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ImageLightbox.module.css'

/** Lightbox strings the owner resolves from its own locale namespace. */
export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  dialog: string
  /** Accessible label of the close control. */
  close: string
}

/**
 * Document-level original-image preview opened by clicking a thumbnail.
 * Delegates modal ownership to the shared primitive: application inertness,
 * initial focus, Tab containment, nested dismissal, Escape/mask close, and
 * connected-opener restoration. Its body portal also escapes transformed or
 * filtered ancestors that would otherwise trap the fixed backdrop.
 *
 * @param props.src - the original image URL.
 * @param props.alt - the image's alt text.
 * @param props.labels - dialog and close-control strings.
 * @param props.onClose - dismiss callback owned by the opener.
 * @returns the modal preview dialog.
 */
export function ImageLightbox({ src, alt, labels, onClose }: {
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
}) {
  return (
    <Modal open headless title={labels.dialog} onClose={onClose} className={css.dialog as string}>
      <img className={css.image} src={src} alt={alt} />
      <button type="button" className={css.close} aria-label={labels.close} onClick={onClose}>
        <IconCloseOutline16 size={16} />
      </button>
    </Modal>
  )
}
