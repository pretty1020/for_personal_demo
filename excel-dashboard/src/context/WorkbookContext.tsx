import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  DatasetDetectionReport,
  ExecutiveMergedModel,
  SheetSnapshot,
  TransformLogEntry,
} from '../types/dashboard'
import { parseFullWorkbookFromFile } from '../utils/parseExcel'
import { buildExecutiveMergedModel } from '../utils/executiveMerge'
import { detectDatasetsFromSnapshots } from '../utils/datasetDetector'
import { buildTransformOptionsFromReport } from '../utils/transformOptionsFromDetection'
import { transformWorkbookSnapshots } from '../utils/transformPipeline'

export interface WorkbookContextValue {
  fileName: string | null
  sheetNames: string[]
  snapshots: Record<string, SheetSnapshot>
  selectedSheet: string | null
  datasetReport: DatasetDetectionReport | null
  executiveModel: ExecutiveMergedModel | null
  transformLogs: TransformLogEntry[]
  isLoading: boolean
  error: string | null
  setSelectedSheet: (name: string | null) => void
  loadWorkbook: (file: File) => Promise<boolean>
  clearWorkbook: () => void
  /** @deprecated use fileName */
  financialFileName: string | null
  /** @deprecated use loadWorkbook */
  loadFinancialWorkbook: (file: File) => Promise<boolean>
}

const WorkbookContext = createContext<WorkbookContextValue | null>(null)

export function WorkbookProvider(props: { children: ReactNode }) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [snapshots, setSnapshots] = useState<Record<string, SheetSnapshot>>({})
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null)
  const [datasetReport, setDatasetReport] = useState<DatasetDetectionReport | null>(null)
  const [executiveModel, setExecutiveModel] = useState<ExecutiveMergedModel | null>(null)
  const [transformLogs, setTransformLogs] = useState<TransformLogEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearWorkbook = useCallback(() => {
    setFileName(null)
    setSheetNames([])
    setSnapshots({})
    setSelectedSheet(null)
    setDatasetReport(null)
    setExecutiveModel(null)
    setTransformLogs([])
    setError(null)
  }, [])

  const loadWorkbook = useCallback(async (file: File): Promise<boolean> => {
    setIsLoading(true)
    setError(null)
    try {
      const bundle = await parseFullWorkbookFromFile(file)
      const reportPre = detectDatasetsFromSnapshots({
        sheetNames: bundle.sheetNames,
        snapshots: bundle.snapshots,
      })
      const transformOpts = buildTransformOptionsFromReport(reportPre)
      const transformed = transformWorkbookSnapshots({
        sheetNames: bundle.sheetNames,
        snapshots: bundle.snapshots,
        options: transformOpts,
      })
      const reportPost = detectDatasetsFromSnapshots({
        sheetNames: bundle.sheetNames,
        snapshots: transformed.snapshots,
      })
      const merged = buildExecutiveMergedModel({
        snapshots: transformed.snapshots,
        report: reportPost,
      })
      setFileName(bundle.fileName)
      setSheetNames(bundle.sheetNames)
      setSnapshots(transformed.snapshots)
      setTransformLogs(transformed.logs)
      setDatasetReport(reportPost)
      setExecutiveModel(merged)
      setSelectedSheet(bundle.sheetNames[0] ?? null)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read workbook.')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  const value = useMemo(
    () => ({
      fileName,
      sheetNames,
      snapshots,
      selectedSheet,
      datasetReport,
      executiveModel,
      transformLogs,
      isLoading,
      error,
      setSelectedSheet,
      loadWorkbook,
      clearWorkbook,
      financialFileName: fileName,
      loadFinancialWorkbook: loadWorkbook,
    }),
    [fileName, sheetNames, snapshots, selectedSheet, datasetReport, executiveModel, transformLogs, isLoading, error, loadWorkbook, clearWorkbook],
  )

  return <WorkbookContext.Provider value={value}>{props.children}</WorkbookContext.Provider>
}

export function useWorkbook(): WorkbookContextValue {
  const ctx = useContext(WorkbookContext)
  if (!ctx) throw new Error('useWorkbook must be used within WorkbookProvider')
  return ctx
}
