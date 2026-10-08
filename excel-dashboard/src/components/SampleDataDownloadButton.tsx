import { downloadApplicationSampleData } from '../utils/applicationSampleData'

type Props = {
  className?: string
  label?: string
}

export function SampleDataDownloadButton({ className, label = 'Sample' }: Props) {
  return (
    <button
      type="button"
      className={className ?? 'cap-btn-ghost-sm sample-data-btn'}
      title="Download sample .xlsx — required sheets, columns, and example values"
      onClick={() => downloadApplicationSampleData()}
    >
      <svg className="sample-data-btn__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 3v10m0 0l4-4m-4 4L8 9M5 21h14"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </button>
  )
}
