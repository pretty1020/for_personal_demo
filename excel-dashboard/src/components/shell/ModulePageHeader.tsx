import type { ReactNode } from 'react'
import { DataSourceBadge } from '../executive/DataSourceBadge'

type Props = {
  title: string
  description?: string
  actions?: ReactNode
  showDataBadge?: boolean
}

export function ModulePageHeader({ title, description, actions, showDataBadge = false }: Props) {
  return (
    <header className="cap-module-header">
      <div className="cap-module-header__main">
        <div>
          <h2 className="cap-module-header__title">{title}</h2>
          {description ? <p className="cap-module-header__desc">{description}</p> : null}
        </div>
        <div className="cap-module-header__actions">
          {showDataBadge ? <DataSourceBadge /> : null}
          {actions}
        </div>
      </div>
    </header>
  )
}
