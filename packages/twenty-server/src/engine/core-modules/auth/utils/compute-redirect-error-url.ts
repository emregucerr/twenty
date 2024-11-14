import { buildWorkspaceURL } from 'src/utils/workspace-url.utils';

export function computeRedirectErrorUrl({
  errorMessage,
  frontBaseUrl,
  subdomain,
}: {
  errorMessage: string;
  frontBaseUrl: string;
  subdomain?: string;
}) {
  const url = buildWorkspaceURL(
    frontBaseUrl,
    { subdomain: subdomain ?? 'app' },
    {
      withPathname: '/verify',
      withSearchParams: { errorMessage },
    },
  );

  return url.toString();
}
