export interface HandlingTarget {
  id: string;
  expected_version: number;
  expected_event_seq?: number;
}

export interface HandlingReviewRow extends HandlingTarget {
  label: string;
  reason: string;
}
