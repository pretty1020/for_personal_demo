import { createContext, useContext } from 'react'

export type ExecChartCardContextValue = {
  expanded: boolean
  /** Inline (card) chart is visible — false when user hid the chart or plot is off-screen. */
  inlineVisible: boolean
  /** Bumped when inline chart is revealed so sizing + D3 redraw. */
  plotGeneration: number
}

export const ExecChartCardContext = createContext<ExecChartCardContextValue>({
  expanded: false,
  inlineVisible: true,
  plotGeneration: 0,
})

export function useExecChartCardExpanded(): boolean {
  return useContext(ExecChartCardContext).expanded
}

export function useExecChartInlineVisible(): boolean {
  return useContext(ExecChartCardContext).inlineVisible
}

export function useExecChartPlotGeneration(): number {
  return useContext(ExecChartCardContext).plotGeneration
}
