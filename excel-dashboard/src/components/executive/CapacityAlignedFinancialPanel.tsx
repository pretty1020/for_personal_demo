import { useEffect, useRef, useState } from 'react'
import { StickyHorizontalScrollbar } from '../StickyHorizontalScrollbar'
import { useCapacityFinancial } from '../../context/CapacityFinancialContext'
import { UnsavedChangesDialog } from '../UnsavedChangesDialog'
import { StableNumberInput } from '../fields/StableNumberInput'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import {
  billingRateLabel,
  defaultBillingRateForType,
  revenueFormulaSummary,
} from '../../planner/capacityBillingRevenue'
import { costFormulaSummary } from '../../planner/capacityFinancialCosts'
import { fmtCurrency, fmtNum } from '../../planner/format'
import {
  REV_PROJ_BILL_RATE_METHODS,
  type RevProjBillRateMethod,
} from '../../planner/revenueProjections/revenueProjectionPersistence'
import {
  BILLABLE_TYPE_OPTIONS,
  canonicalBillingType,
  type CanonicalBillingType,
} from '../../utils/staffingCapacity/billingModel'
import { ChannelFinancialRollupPanel } from './ChannelFinancialRollupPanel'

export function CapacityAlignedFinancialPanel({ variant = 'full' }: { variant?: 'assumptions' | 'table' | 'full' }) {
  /** Mirrored by floating scrollbars: both tables run past the fold. */
  const weeklyScrollRef = useRef<HTMLDivElement | null>(null)
  const fullScrollRef = useRef<HTMLDivElement | null>(null)
  const [calculationsOpen, setCalculationsOpen] = useState(false)
  const [ratesDirty, setRatesDirty] = useState(false)
  const {
    hasScope,
    defaultRate,
    costInputs,
    weeklyFinancials,
    isCombined,
    isPortfolio,
    rateInput,
    hourlyInput,
    supportInput,
    trainingRateInput,
    otherCostInput,
    billingTypeDraft,
    billRateMethodDraft,
    setRateInput,
    setHourlyInput,
    setSupportInput,
    setTrainingRateInput,
    setOtherCostInput,
    setBillingTypeDraft,
    setBillRateMethodDraft,
    saveAssumptions,
    projectionLinked,
    projectionLabel,
    scenarioId,
  } = useCapacityFinancial()
  const { isBlocked: navigationBlocked, proceed: proceedNavigation, cancel: cancelNavigation } =
    useUnsavedChangesGuard({ when: variant !== 'table' && ratesDirty && !isCombined })

  useEffect(() => {
    setRatesDirty(false)
  }, [scenarioId])

  if (!hasScope) {
    if (variant === 'table') return null
    return (
      <section className="cap-fin-capacity-panel saas-card mb-6">
        <p className="saas-muted m-0 text-sm">
          Open Capacity and pick a client or team — this page will follow the same view automatically.
        </p>
      </section>
    )
  }

  const showVolume =
    !isCombined &&
    (canonicalBillingType(billingTypeDraft) === 'Transactional' ||
      billRateMethodDraft === 'per_minute' ||
      billRateMethodDraft === 'per_transaction')

  const onBillableTypeChange = (next: CanonicalBillingType) => {
    setBillingTypeDraft(next)
    if (next === 'FTE' && billRateMethodDraft === 'hourly') setBillRateMethodDraft('monthly')
    setRateInput(String(defaultBillingRateForType(next)))
    setRatesDirty(true)
  }

  const saveRates = () => {
    saveAssumptions()
    setRatesDirty(false)
  }

  if (variant === 'table') {
    return (
      <section className="cap-fin-capacity-panel saas-card mb-6" aria-label="Capacity weekly financial breakdown">
        <h3 className="m-0 mb-3 text-base font-bold text-slate-900">Week by week</h3>
        <p className="saas-muted m-0 mb-3 text-xs">
          {revenueFormulaSummary(billingTypeDraft, billRateMethodDraft)} Revenue, cost, and bill rates come from
          each LOB’s Revenue Projection settings.
        </p>
        <div className="cap-ledger-table-wrap cap-forecast-table-card__table" ref={weeklyScrollRef}>
          <table className="cap-ledger-table cap-forecast-table cap-financial-table">
            <thead>
              <tr>
                <th>Week</th>
                <th>Status</th>
                <th>Production FTE</th>
                {showVolume ? <th>Volume</th> : <th>Production HC</th>}
                <th>Training + Nesting HC</th>
                <th>Projected revenue</th>
                <th>Actual revenue</th>
                <th>Labor</th>
                <th>Salary-like / support</th>
                <th>OPEX / other lines</th>
                <th>Projected cost</th>
                <th>Actual cost</th>
              </tr>
            </thead>
            <tbody>
              {weeklyFinancials.map((row) => (
                <tr key={`cap-fin-${row.week}`}>
                  <td>{row.week}</td>
                  <td>
                    <span
                      className={
                        row.status === 'Actual'
                          ? 'cap-ledger-matrix__week-status cap-ledger-matrix__week-status--actual'
                          : 'cap-ledger-matrix__week-status cap-ledger-matrix__week-status--planned'
                      }
                    >
                      {row.status}
                    </span>
                  </td>
                  <td>{fmtNum(row.productionFte, 1)}</td>
                  <td>{showVolume ? fmtNum(row.volume, 0) : fmtNum(row.productionHc, 0)}</td>
                  <td>{fmtNum(row.trainingHc + row.nestingHc, 0)}</td>
                  <td>{fmtCurrency(row.projectedRevenue)}</td>
                  <td>{fmtCurrency(row.actualRevenue)}</td>
                  <td>{fmtCurrency(row.projectedLabor)}</td>
                  <td>{fmtCurrency(row.projectedSalarySupport)}</td>
                  <td>{fmtCurrency(row.projectedOpex)}</td>
                  <td>{fmtCurrency(row.projectedCost)}</td>
                  <td>{fmtCurrency(row.actualCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <StickyHorizontalScrollbar targetRef={weeklyScrollRef} label="Scroll the weekly financials" />
      </section>
    )
  }

  return (
    <section className="cap-fin-capacity-panel saas-card mb-6">
      <div className="cap-fin-capacity-panel__head">
        <div>
          <h3 className="m-0 text-base font-bold text-slate-900">Rates</h3>
          <button
            type="button"
            className="cap-fin-calculation-toggle mt-2"
            aria-expanded={calculationsOpen}
            onClick={() => setCalculationsOpen((value) => !value)}
          >
            {calculationsOpen ? 'Hide calculation' : 'Calculation'}
          </button>
          {calculationsOpen ? (
            <div className="cap-fin-calculation-panel mt-2">
              <p className="saas-muted m-0 text-xs">
                {isCombined
                  ? 'Financial Summary = Σ over LOBs of (weekly revenue − weekly cost), using each LOB’s Revenue Projection billing type, bill rate method, bill rate, and costs.'
                  : revenueFormulaSummary(billingTypeDraft, billRateMethodDraft)}
              </p>
              <p className="saas-muted m-0 mt-1 text-xs">{costFormulaSummary()}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="cap-fin-capacity-panel__rate mt-3">
        <label className="saas-field">
          <span className="saas-field__label">Billable Type</span>
          <select
            className="cap-field__input"
            value={billingTypeDraft}
            onChange={(event) => onBillableTypeChange(event.target.value as CanonicalBillingType)}
            disabled={isCombined}
          >
            {BILLABLE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="saas-field">
          <span className="saas-field__label">Bill rate method</span>
          <select
            className="cap-field__input"
            value={billRateMethodDraft}
            onChange={(event) => {
              setBillRateMethodDraft(event.target.value as RevProjBillRateMethod)
              setRatesDirty(true)
            }}
            disabled={isCombined}
          >
            {REV_PROJ_BILL_RATE_METHODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="saas-field">
          <span className="saas-field__label">{billingRateLabel(billingTypeDraft, billRateMethodDraft)}</span>
          <StableNumberInput
            className="cap-field__input"
            min={0}
            step={
              billRateMethodDraft === 'per_minute' || billRateMethodDraft === 'per_transaction'
                ? 0.01
                : billRateMethodDraft === 'monthly'
                  ? 50
                  : 0.5
            }
            placeholder={fmtNum(defaultRate, 2)}
            value={rateInput}
            onChange={(raw) => {
              setRateInput(raw)
              setRatesDirty(true)
            }}
            disabled={isCombined}
            aria-label={billingRateLabel(billingTypeDraft, billRateMethodDraft)}
          />
        </label>
        <label className="saas-field">
          <span className="saas-field__label">Hourly salary (USD)</span>
          <StableNumberInput
            className="cap-field__input"
            min={0}
            step={0.5}
            placeholder={fmtNum(costInputs.hourlySalaryUsd, 2)}
            value={hourlyInput}
            onChange={(raw) => {
              setHourlyInput(raw)
              setRatesDirty(true)
            }}
            disabled={isCombined}
            aria-label="Hourly salary (USD)"
          />
        </label>
        <label className="saas-field">
          <span className="saas-field__label">Support salary / wk (USD)</span>
          <StableNumberInput
            className="cap-field__input"
            min={0}
            step={50}
            placeholder={fmtNum(costInputs.supportSalaryUsd, 2)}
            value={supportInput}
            onChange={(raw) => {
              setSupportInput(raw)
              setRatesDirty(true)
            }}
            disabled={isCombined}
            aria-label="Support salary / wk (USD)"
          />
        </label>
        <label className="saas-field">
          <span className="saas-field__label">Training salary rate / HC / wk (USD)</span>
          <StableNumberInput
            className="cap-field__input"
            min={0}
            step={25}
            placeholder={fmtNum(costInputs.trainingSalaryRateUsd, 2)}
            value={trainingRateInput}
            onChange={(raw) => {
              setTrainingRateInput(raw)
              setRatesDirty(true)
            }}
            disabled={isCombined}
            aria-label="Training salary rate / HC / wk (USD)"
          />
        </label>
        <label className="saas-field">
          <span className="saas-field__label">Other cost / wk (USD)</span>
          <StableNumberInput
            className="cap-field__input"
            min={0}
            step={50}
            placeholder={fmtNum(costInputs.otherCostUsd, 2)}
            value={otherCostInput}
            onChange={(raw) => {
              setOtherCostInput(raw)
              setRatesDirty(true)
            }}
            disabled={isCombined}
            aria-label="Other cost / wk (USD)"
          />
        </label>
        <button
          type="button"
          className="saas-btn saas-btn--secondary"
          onClick={saveRates}
          disabled={isCombined}
        >
          Save Setup
        </button>
      </div>
      {!isCombined ? (
        <p className="saas-muted m-0 mt-2 text-xs">
          {projectionLinked
            ? `Rates and costs come from Revenue Projections${projectionLabel ? ` (${projectionLabel})` : ''}. Save writes back to that line.`
            : 'No matching Revenue Projection line yet. Save stores rates on Capacity; add a Client · LOB line on Revenue Projections to drive Overview.'}
        </p>
      ) : (
        <p className="saas-muted m-0 mt-2 text-xs">
          {isPortfolio
            ? 'Each LOB uses its Revenue Projection billing type, bill rate method, bill rate, and costs. Combined totals sum those LOBs.'
            : 'Each LOB uses its own Revenue Projection rates and costs. Combined Financial Summary adds them together.'}
        </p>
      )}
      {ratesDirty && !isCombined ? (
        <p className="saas-muted m-0 mt-2 text-xs" role="status">
          Unsaved rate or cost edits. Use Save Setup before leaving this page.
        </p>
      ) : null}

      {variant === 'full' ? (
        <>
        <div className="cap-ledger-table-wrap cap-forecast-table-card__table mt-3" ref={fullScrollRef}>
          <table className="cap-ledger-table cap-forecast-table cap-financial-table">
            <thead>
              <tr>
                <th>Week</th>
                <th>Status</th>
                <th>Production FTE</th>
                {showVolume ? <th>Volume</th> : <th>Production HC</th>}
                <th>Training + Nesting HC</th>
                <th>Projected revenue</th>
                <th>Actual revenue</th>
                <th>Labor</th>
                <th>Salary-like / support</th>
                <th>OPEX / other lines</th>
                <th>Projected cost</th>
                <th>Actual cost</th>
              </tr>
            </thead>
            <tbody>
              {weeklyFinancials.map((row) => (
                <tr key={`cap-fin-${row.week}`}>
                  <td>{row.week}</td>
                  <td>
                    <span
                      className={
                        row.status === 'Actual'
                          ? 'cap-ledger-matrix__week-status cap-ledger-matrix__week-status--actual'
                          : 'cap-ledger-matrix__week-status cap-ledger-matrix__week-status--planned'
                      }
                    >
                      {row.status}
                    </span>
                  </td>
                  <td>{fmtNum(row.productionFte, 1)}</td>
                  <td>{showVolume ? fmtNum(row.volume, 0) : fmtNum(row.productionHc, 0)}</td>
                  <td>{fmtNum(row.trainingHc + row.nestingHc, 0)}</td>
                  <td>{fmtCurrency(row.projectedRevenue)}</td>
                  <td>{fmtCurrency(row.actualRevenue)}</td>
                  <td>{fmtCurrency(row.projectedLabor)}</td>
                  <td>{fmtCurrency(row.projectedSalarySupport)}</td>
                  <td>{fmtCurrency(row.projectedOpex)}</td>
                  <td>{fmtCurrency(row.projectedCost)}</td>
                  <td>{fmtCurrency(row.actualCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <StickyHorizontalScrollbar targetRef={fullScrollRef} label="Scroll the full financials" />
        </>
      ) : null}

      {variant === 'full' ? <ChannelFinancialRollupPanel /> : null}

      {navigationBlocked ? (
        <UnsavedChangesDialog
          title="Save Setup?"
          message="You have unsaved rate or cost changes. Save Setup before leaving this page?"
          saveLabel="Save Setup"
          onSave={() => {
            saveRates()
            proceedNavigation()
          }}
          onDiscard={proceedNavigation}
          onCancel={cancelNavigation}
        />
      ) : null}
    </section>
  )
}
