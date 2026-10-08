import { useMemo, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { IdealFinancialProvider, useIdealFinancial } from '../context/IdealFinancialContext'
import { CapacityFinancialProvider } from '../context/CapacityFinancialContext'
import { IdealFinancialScenarioNav } from '../components/executive/IdealFinancialScenarioNav'
import { FinancialFilterCard } from '../components/executive/FinancialFilterCard'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { useCapacityFinancialWeekRange } from '../hooks/useCapacityFinancialSummary'

function IdealFinancialHeader() {
  const {
    periodLabel,
    capacityScopeLabel,
    dateRangeActive,
    calendarYear,
    setCalendarYear,
    yearOptions,
    periodView,
    setPeriodView,
    month,
    setMonth,
    monthOptions,
    quarter,
    setQuarter,
    client,
    setClient,
    industry,
    setIndustry,
    location,
    setLocation,
    lobId,
    setLobId,
    channel,
    setChannel,
    showNextYear,
    setShowNextYear,
    financialClientOptions,
    financialLocationOptions,
    financialChannelOptions,
    financialLobOptions,
  } = useIdealFinancial()

  const headerDescription = dateRangeActive
    ? `${periodLabel} · ${capacityScopeLabel}`
    : capacityScopeLabel

  return (
    <div className="cap-module-header cap-module-header--stacked cap-module-header--financial">
      <div className="cap-module-header__row">
        <ModulePageHeader title="Financials" description={headerDescription} />
      </div>

      <IdealFinancialScenarioNav />

      <FinancialFilterCard
        fiscalYear={calendarYear}
        yearOptions={yearOptions}
        onFiscalYearChange={setCalendarYear}
        periodView={periodView}
        onPeriodViewChange={setPeriodView}
        month={month}
        monthOptions={monthOptions}
        onMonthChange={setMonth}
        quarter={quarter}
        onQuarterChange={setQuarter}
        client={client}
        clients={financialClientOptions}
        onClientChange={setClient}
        industry={industry}
        onIndustryChange={setIndustry}
        location={location}
        locations={financialLocationOptions}
        onLocationChange={setLocation}
        lobId={lobId}
        lobs={financialLobOptions}
        onLobChange={setLobId}
        channel={channel}
        channels={financialChannelOptions}
        onChannelChange={setChannel}
        showNextYear={showNextYear}
        onToggleNextYear={() => setShowNextYear(!showNextYear)}
      />
    </div>
  )
}

function IdealFinancialCapacityShell({ children }: { children: ReactNode }) {
  const { client, location, lobId, channel, financialScopeId } = useIdealFinancial()
  const { weekStart, weekEnd } = useCapacityFinancialWeekRange()
  const cardFilters = useMemo(
    () => ({ clientName: client, location, lobId, channel }),
    [channel, client, lobId, location],
  )

  return (
    <CapacityFinancialProvider
      weekStart={weekStart}
      weekEnd={weekEnd}
      scopeId={financialScopeId}
      cardFilters={cardFilters}
    >
      {children}
    </CapacityFinancialProvider>
  )
}

function IdealFinancialLayoutInner({ embedded }: { embedded?: boolean }) {
  return (
    <IdealFinancialCapacityShell>
      <div className={`cap-module-page cap-module-page--financial${embedded ? ' cap-module-page--embedded' : ''}`}>
        <IdealFinancialHeader />
        <main className={`cap-module-main${embedded ? ' cap-module-main--embedded' : ''}`}>
          <Outlet />
        </main>
      </div>
    </IdealFinancialCapacityShell>
  )
}

export function IdealFinancialLayout({ embedded = false }: { embedded?: boolean }) {
  return (
    <IdealFinancialProvider>
      <IdealFinancialLayoutInner embedded={embedded} />
    </IdealFinancialProvider>
  )
}
