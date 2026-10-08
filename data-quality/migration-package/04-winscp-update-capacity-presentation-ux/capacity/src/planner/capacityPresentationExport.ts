import html2canvas from 'html2canvas'

function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 80) || 'staffing_plan'
}

function triggerPngDownload(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename.endsWith('.png') ? filename : `${filename}.png`
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/**
 * Capture a DOM node as a high-resolution PNG for presentation decks.
 * Charts (canvas/svg) and the staffing matrix are included when inside `element`.
 */
export async function downloadElementAsPng(
  element: HTMLElement,
  filename: string,
  options?: { scale?: number; backgroundColor?: string },
): Promise<void> {
  const canvas = await html2canvas(element, {
    backgroundColor: options?.backgroundColor ?? '#ffffff',
    scale: options?.scale ?? Math.min(2.5, Math.max(2, window.devicePixelRatio || 2)),
    useCORS: true,
    logging: false,
    // Include overflow content that is scrolled within the matrix.
    scrollX: 0,
    scrollY: 0,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  })
  triggerPngDownload(canvas.toDataURL('image/png'), safeFilename(filename))
}

/** Capture several nodes onto one tall presentation PNG (charts then matrix). */
export async function downloadPresentationCompositePng(
  sections: Array<{ element: HTMLElement; label?: string }>,
  filename: string,
): Promise<void> {
  const usable = sections.filter((section) => section.element)
  if (!usable.length) return

  const scale = Math.min(2.5, Math.max(2, window.devicePixelRatio || 2))
  const captures: HTMLCanvasElement[] = []
  for (const section of usable) {
    const canvas = await html2canvas(section.element, {
      backgroundColor: '#ffffff',
      scale,
      useCORS: true,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: section.element.scrollWidth,
      windowHeight: section.element.scrollHeight,
    })
    captures.push(canvas)
  }

  const gap = Math.round(24 * scale)
  const pad = Math.round(28 * scale)
  const width = Math.max(...captures.map((c) => c.width)) + pad * 2
  const height =
    pad * 2 +
    captures.reduce((sum, c) => sum + c.height, 0) +
    gap * Math.max(0, captures.length - 1)

  const composite = document.createElement('canvas')
  composite.width = width
  composite.height = height
  const ctx = composite.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, width, height)

  let y = pad
  for (const canvas of captures) {
    const x = pad + Math.round((width - pad * 2 - canvas.width) / 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x - 8, y - 8, canvas.width + 16, canvas.height + 16)
    ctx.drawImage(canvas, x, y)
    y += canvas.height + gap
  }

  triggerPngDownload(composite.toDataURL('image/png'), safeFilename(filename))
}
