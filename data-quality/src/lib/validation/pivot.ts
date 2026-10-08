import type { ParsedTable } from "@/lib/validation/types";
import type { PivotDetection } from "@/types/database";

function cellText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole-cell / word-boundary match — avoids false hits on "Total Amount" column names alone. */
function cellMatches(cell: string, pattern: RegExp): boolean {
  return pattern.test(cell);
}

/**
 * Heuristic pivot / crosstab detector.
 * Tuned to avoid flagging normal tabular data (numeric fact tables, columns named
 * "Total …", etc.). Prefer strong signals (pivot wording, grand-total rows).
 */
export function detectPivotLike(table: ParsedTable): PivotDetection {
  const signals: string[] = [];
  let score = 0;
  const { headers, rawRows } = table;
  const dataRows = rawRows.slice(1);
  const bodyCells = dataRows.flatMap((row) => row.map(cellText)).filter(Boolean);
  const allCells = rawRows.flatMap((row) => row.map(cellText)).filter(Boolean);

  const hasPivotWording = allCells.some((c) =>
    cellMatches(c, /^(pivot(\s+table)?|crosstab|cross[\s-]?tab)$/),
  );
  if (hasPivotWording) {
    signals.push("Pivot/crosstab wording detected");
    score += 4;
  }

  // Summary labels only in row bodies (ignore a column named "Total").
  const grandTotalAsLoneCell = dataRows.some((row) => {
    const first = cellText(row[0]);
    return cellMatches(first, /^(grand\s+)?totals?$/);
  });
  const hasGrandTotalPhrase = bodyCells.some((c) =>
    cellMatches(c, /^grand\s+totals?(\s+of\s+.+)?$/),
  );
  if (hasGrandTotalPhrase) {
    signals.push("Contains grand-total / total summary rows typical of pivot reports");
    score += 3;
  } else if (grandTotalAsLoneCell) {
    // A lone "Total" row label is weak on its own — common in tabular summaries.
    signals.push("Contains a total summary row label");
    score += 2;
  }

  const hasSubtotalRow = dataRows.some((row) =>
    cellMatches(cellText(row[0]), /^sub-?totals?$/),
  );
  if (hasSubtotalRow) {
    signals.push("Contains subtotal row labels");
    score += 2;
  }

  // Wide month/period matrices only — normal 3–6 column fact tables must not match.
  const headerCount = headers.filter((h) => cellText(h)).length;
  if (headerCount >= 8 && dataRows.length >= 3) {
    const numericOtherCols = dataRows.map((r) => {
      const nums = r
        .slice(1)
        .filter((c) => c !== "" && !Number.isNaN(Number(String(c).replace(/,/g, ""))));
      return nums.length;
    });
    const avgNumeric = numericOtherCols.length
      ? numericOtherCols.reduce((a, b) => a + b, 0) / numericOtherCols.length
      : 0;
    const firstCol = dataRows.map((r) => r[0] || "");
    const nonEmptyFirst = firstCol.filter((c) => cellText(c) !== "").length;
    const firstColLabelRatio = nonEmptyFirst / Math.max(firstCol.length, 1);
    if (avgNumeric >= headerCount * 0.65 && firstColLabelRatio > 0.6) {
      signals.push("Wide numeric matrix with row labels — possible crosstab");
      score += 2;
    }
  }

  if (rawRows.length >= 3 && headerCount > 6) {
    const row0 = rawRows[0].filter((c) => cellText(c)).length;
    const row1 = rawRows[1].filter((c) => cellText(c)).length;
    const row2 = rawRows[2].filter((c) => cellText(c)).length;
    if (row0 > 0 && row1 > 0 && row2 > 0 && Math.abs(row0 - row1) <= 1 && Math.abs(row1 - row2) <= 1) {
      const allText = rawRows.slice(0, 3).every((r) =>
        r.every((c) => !c || Number.isNaN(Number(String(c).replace(/,/g, "")))),
      );
      if (allText) {
        signals.push("Multiple dense text header rows");
        score += 2;
      }
    }
  }

  // Need clear evidence — a single weak cue must never fail a file.
  const likelyPivot = score >= 5;
  return { score, signals, likelyPivot };
}
