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
 * Closes on Escape, backdrop press, or the close control. The shared Modal
 * primitive owns background inertness, focus containment, nested Escape
 * ordering, return focus, and the body portal.
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
    <Modal open onClose={onClose} title={labels.dialog} className={css.backdrop ?? ''} headless>
      <img className={css.image} src={src} alt={alt} />
      <button autoFocus type="button" className={css.close} aria-label={labels.close} onClick={onClose}>
        <IconCloseOutline16 size={16} />
      </button>
    </Modal>
  )
}
