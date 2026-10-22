export type Page = {
  id: string;
  title: string;
  baseRef: string;
};

export type Base = {
  baseRef: string;
  label: string;
  kind: string;
};

export type CaptureResult = {
  summary: string;
  created: Page[];
  updated: Page[];
};

export type ExploreResult = {
  answer: string;
  sources: Page[];
};
