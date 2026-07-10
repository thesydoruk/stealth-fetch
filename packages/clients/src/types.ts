export interface FetchedPage {
  url: string;
  finalUrl?: string | null;
  statusCode?: number | null;
  contentType?: string | null;
  html: string;
  fetchedAt: Date;
}
