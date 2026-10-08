export type GuideSection = {
  title: string;
  items: string[];
};

export const userGuideSections: GuideSection[] = [
  {
    title: "Upload files",
    items: [
      "Go to Upload and select the workflow that matches your file.",
      "Drag and drop a CSV or Excel file, or click Choose file.",
      "Validation runs automatically after upload. Open the file record to see results.",
      "Use Scan folder when a workflow is set to watch a local directory.",
    ],
  },
  {
    title: "Workflows",
    items: [
      "Create a workflow to define required columns, validation rules, and checklist items.",
      "Enable or disable workflows from the Workflows list.",
      "Use Run / scan to ingest files from a configured source path.",
    ],
  },
  {
    title: "Understanding results",
    items: [
      "Processed — file passed validation and the checklist gate.",
      "Blocked / Rejected — validation or checklist failed; open the file for details.",
      "Validating — checks are still running.",
      "Duplicate blocked — the same file was already submitted for this workflow.",
    ],
  },
  {
    title: "Reports & audit",
    items: [
      "Reports lists processed files, failures, and validation history.",
      "Audit log records every upload, validation, and processing decision.",
      "Export dashboard metrics from Settings or the Dashboard filters panel.",
    ],
  },
];
