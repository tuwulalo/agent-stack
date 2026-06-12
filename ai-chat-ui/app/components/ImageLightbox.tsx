'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, ExternalLink, X } from 'lucide-react'

export interface LightboxImage {
  url: string
  name: string
  size?: number
  /** Shared layout id — must match the motion thumbnail in the bubble for
      a FLIP "expand from origin" transition. Optional: if absent, falls
      back to scale-from-center. */
  layoutId?: string
}

interface ImageLightboxProps {
  image: LightboxImage | null
  onClose: () => void
}

export function ImageLightbox({ image, onClose }: ImageLightboxProps) {
  /* lock body scroll + Esc to close while open */
  useEffect(() => {
    if (!image) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [image, onClose])

  return (
    <AnimatePresence>
      {image && (
        <motion.div
          key="lightbox"
          className="fixed inset-0 z-[100] flex items-center justify-center p-6 cursor-zoom-out backdrop-blur-2xl bg-black/65"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          onClick={onClose}
        >
          {/* file meta + actions */}
          <motion.div
            className="absolute top-5 left-5 flex items-center gap-2 text-[12px] text-white/85 bg-white/[0.06] border border-white/10 rounded-md px-3 py-1.5 backdrop-blur-md"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ delay: 0.05, duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="font-mono truncate max-w-[40vw]" title={image.url}>
              {image.name}
            </span>
            {typeof image.size === 'number' && (
              <span className="text-white/50">
                {(image.size / 1024).toFixed(1)} KB
              </span>
            )}
            <a
              href={image.url}
              download={image.name}
              className="ml-1 w-6 h-6 grid place-items-center rounded text-white/65 hover:text-white hover:bg-white/[0.08] transition"
              onClick={(e) => e.stopPropagation()}
              title="Download"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
            <a
              href={image.url}
              target="_blank"
              rel="noreferrer"
              className="w-6 h-6 grid place-items-center rounded text-white/65 hover:text-white hover:bg-white/[0.08] transition"
              onClick={(e) => e.stopPropagation()}
              title="Open in a new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </motion.div>

          {/* close button */}
          <motion.button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            className="absolute top-5 right-5 w-10 h-10 grid place-items-center rounded-full bg-white/[0.08] hover:bg-white/[0.16] text-white border border-white/15 transition cursor-pointer"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ delay: 0.05, duration: 0.2 }}
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </motion.button>

          {/* the image — uses layoutId to FLIP-grow from the origin thumbnail */}
          <motion.img
            key={image.url}
            layoutId={image.layoutId}
            src={image.url}
            alt={image.name}
            draggable={false}
            initial={image.layoutId ? false : { scale: 0.9, opacity: 0 }}
            animate={image.layoutId ? { opacity: 1 } : { scale: 1, opacity: 1 }}
            exit={image.layoutId ? { opacity: 1 } : { scale: 0.94, opacity: 0 }}
            transition={{
              // Slow, smooth spring — ~500ms expansion with a tiny settle
              layout: { type: 'spring', damping: 32, stiffness: 200, mass: 1 },
              opacity: { duration: 0.18, ease: [0.4, 0, 0.2, 1] },
              scale: { type: 'spring', damping: 32, stiffness: 200, mass: 1 },
            }}
            onClick={(e) => e.stopPropagation()}
            className="max-w-[92vw] max-h-[88vh] rounded-lg shadow-[0_30px_80px_rgba(0,0,0,0.7)] ring-1 ring-white/10 cursor-default select-none"
          />

          {/* hint at bottom */}
          <motion.div
            className="absolute bottom-5 left-1/2 -translate-x-1/2 text-[11px] text-white/45 select-none pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.15, duration: 0.25 }}
          >
            click outside the image or press Esc to close
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
