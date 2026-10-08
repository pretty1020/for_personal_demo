export const DEFAULT_CHECKLIST_ITEMS: {
  item_key: string;
  label: string;
  is_critical: boolean;
  sort_order: number;
}[] = [
  { item_key: "file_naming_valid", label: "File naming valid", is_critical: true, sort_order: 10 },
  {
    item_key: "required_columns_complete",
    label: "Required columns complete",
    is_critical: true,
    sort_order: 20,
  },
  { item_key: "no_pivot_format", label: "No pivot / non-tabular format", is_critical: true, sort_order: 30 },
  {
    item_key: "no_missing_mandatory",
    label: "No missing mandatory fields",
    is_critical: true,
    sort_order: 40,
  },
  { item_key: "data_types_valid", label: "Data types valid", is_critical: true, sort_order: 50 },
  { item_key: "dates_valid", label: "Dates valid", is_critical: true, sort_order: 60 },
  { item_key: "no_duplicate_rows", label: "No duplicate rows", is_critical: true, sort_order: 70 },
  {
    item_key: "warnings_acknowledged",
    label: "Warnings acknowledged",
    is_critical: true,
    sort_order: 80,
  },
];
