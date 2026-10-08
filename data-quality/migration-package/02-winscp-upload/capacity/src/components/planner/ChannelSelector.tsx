import type { ChannelType } from '../../planner/types'
import { CHANNEL_LABELS, CHANNEL_TYPES } from '../../planner/types'

type Props = {
  selected: ChannelType[]
  onChange: (channels: ChannelType[]) => void
  required?: boolean
  compact?: boolean
  /** When true, only one channel can be selected (dropdown). */
  single?: boolean
}

export function ChannelSelector({
  selected,
  onChange,
  required = true,
  compact = false,
  single = false,
}: Props) {
  if (single) {
    const value = selected[0] ?? ''
    return (
      <div className={compact ? 'channel-selector channel-selector--compact' : 'channel-selector'}>
        <label className="saas-field m-0">
          <span className="saas-field__label">
            Supported channel
            {required ? <span className="text-rose-600"> *</span> : null}
          </span>
          <select
            className="cap-field__input mt-1"
            value={value}
            onChange={(event) => {
              const next = event.target.value as ChannelType
              if (!next) {
                if (!required) onChange([])
                return
              }
              onChange([next])
            }}
          >
            <option value="" disabled={required}>
              Select a channel
            </option>
            {CHANNEL_TYPES.map((channel) => (
              <option key={channel} value={channel}>
                {CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
        </label>
        <p className="cap-panel__desc m-0 mt-2">
          Each LOB uses one channel for staffing assumptions and Required Production FTE.
        </p>
      </div>
    )
  }

  const toggle = (channel: ChannelType) => {
    if (selected.includes(channel)) {
      const next = selected.filter((c) => c !== channel)
      if (required && next.length === 0) return
      onChange(next)
    } else {
      onChange([...selected, channel])
    }
  }

  return (
    <div className={compact ? 'channel-selector channel-selector--compact' : 'channel-selector'}>
      <p className="saas-field__label m-0">
        Supported channels
        {required ? <span className="text-rose-600"> *</span> : null}
      </p>
      <p className="cap-panel__desc m-0 mt-1">
        Select one or more channels. Each channel maintains its own assumptions and staffing calculation.
      </p>
      <div className="channel-selector__grid mt-3">
        {CHANNEL_TYPES.map((channel) => {
          const isSelected = selected.includes(channel)
          return (
            <button
              key={channel}
              type="button"
              className={`channel-selector__chip${isSelected ? ' channel-selector__chip--active' : ''}`}
              onClick={() => toggle(channel)}
              aria-pressed={isSelected}
            >
              {CHANNEL_LABELS[channel]}
            </button>
          )
        })}
      </div>
      {selected.length > 0 ? (
        <p className="cap-panel__desc m-0 mt-2">
          Selected: {selected.map((c) => CHANNEL_LABELS[c]).join(', ')}
        </p>
      ) : (
        <p className="text-sm text-rose-600 mt-2">Select at least one channel.</p>
      )}
    </div>
  )
}
