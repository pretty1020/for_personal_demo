import { jsPDF } from 'jspdf'
import {
  USER_GUIDE_INTRO,
  USER_GUIDE_SECTIONS,
  type UserGuideSection,
} from './userGuide'

const BRAND = {
  navy: '#1f3d34',
  mid: '#2c5648',
  cyan: '#8c7348',
  lime: '#6d7f4e',
  muted: '#6e675f',
  ink: '#1c1915',
} as const

function wrapLines(doc: jsPDF, text: string, maxWidth: number): string[] {
  return doc.splitTextToSize(text, maxWidth) as string[]
}

function ensureSpace(doc: jsPDF, y: number, needed: number, margin: number): number {
  const pageHeight = doc.internal.pageSize.getHeight()
  if (y + needed <= pageHeight - margin) return y
  doc.addPage()
  return margin
}

function drawSection(doc: jsPDF, section: UserGuideSection, startY: number, margin: number, maxWidth: number): number {
  let y = ensureSpace(doc, startY, 28, margin)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(BRAND.navy)
  doc.text(section.title, margin, y)
  y += 6

  doc.setDrawColor(BRAND.cyan)
  doc.setLineWidth(0.6)
  doc.line(margin, y, margin + 36, y)
  y += 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(BRAND.muted)
  for (const line of wrapLines(doc, section.summary, maxWidth)) {
    y = ensureSpace(doc, y, 6, margin)
    doc.text(line, margin, y)
    y += 5
  }
  y += 4

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(BRAND.mid)
  y = ensureSpace(doc, y, 6, margin)
  doc.text('Steps', margin, y)
  y += 6

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(BRAND.ink)
  section.steps.forEach((step, index) => {
    const lines = wrapLines(doc, `${index + 1}. ${step}`, maxWidth - 4)
    for (const line of lines) {
      y = ensureSpace(doc, y, 5.5, margin)
      doc.text(line, margin + 2, y)
      y += 5
    }
    y += 1.5
  })

  if (section.tips.length) {
    y += 2
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(BRAND.lime)
    y = ensureSpace(doc, y, 6, margin)
    doc.text('Tips', margin, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(BRAND.ink)
    for (const tip of section.tips) {
      const lines = wrapLines(doc, `• ${tip}`, maxWidth - 4)
      for (const line of lines) {
        y = ensureSpace(doc, y, 5.5, margin)
        doc.text(line, margin + 2, y)
        y += 5
      }
      y += 1.5
    }
  }

  return y + 8
}

/** Branded PDF export for offline reading / sharing. */
export function downloadUserGuidePdf(): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 16
  const maxWidth = pageWidth - margin * 2
  let y = margin

  doc.setFillColor(31, 61, 52)
  doc.rect(0, 0, pageWidth, 28, 'F')
  doc.setFillColor(140, 115, 72)
  doc.rect(0, 28, pageWidth, 1.4, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Capacity Planning', margin, 14)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text('User Guide', margin, 21)

  y = 40
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(BRAND.ink)
  for (const line of wrapLines(doc, USER_GUIDE_INTRO, maxWidth)) {
    doc.text(line, margin, y)
    y += 5
  }
  y += 8

  for (const section of USER_GUIDE_SECTIONS) {
    y = drawSection(doc, section, y, margin, maxWidth)
  }

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    doc.setFontSize(8)
    doc.setTextColor(BRAND.muted)
    doc.text(`Capacity Planning · User Guide · ${page} / ${pageCount}`, margin, doc.internal.pageSize.getHeight() - 8)
  }

  doc.save('Capacity_Planning_User_Guide.pdf')
}
