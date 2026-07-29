import { requireProjectInScope } from '@/lib/page-scope';
import { ReplayClient } from './ReplayClient';

/**
 * A single session replay — a project-scoped PAGE, and the page-class proof of
 * the active-company boundary. The `projectId` is a URL search param, so this is
 * a Server Component that asserts the project is in the ACTIVE company before
 * rendering: a foreign project id returns 404 (via notFound()), exactly like the
 * API seam, so a direct page URL never leaks that a foreign project exists.
 */
export default async function ReplayPlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { sessionId } = await params;
  const sp = await searchParams;
  const projectId = typeof sp.projectId === 'string' ? sp.projectId : null;

  // Enforce the boundary whenever a project is addressed. With no projectId the
  // client renders its empty state (unchanged), and the replay API stays gated.
  if (projectId) {
    await requireProjectInScope(projectId);
  }

  return <ReplayClient sessionId={sessionId} />;
}
