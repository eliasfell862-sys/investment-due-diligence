import { createBrowserRouter } from 'react-router-dom';
import { ProjectDashboardRoute } from '../features/dashboard/ProjectDashboardRoute';
import { ProjectDataRoomRoute } from '../features/data-room/ProjectDataRoomRoute';
import { NewProjectPage } from '../features/projects/NewProjectPage';
import { ProjectListPage } from '../features/projects/ProjectListPage';
import { appDb } from '../infrastructure/db/app-db';
import { CandidateReviewService } from '../infrastructure/db/candidate-review-service';
import { DocumentEvidenceRepository } from '../infrastructure/db/document-evidence-repository';
import { EvidenceRepository } from '../infrastructure/db/evidence-repository';
import { ProjectRepository } from '../infrastructure/db/project-repository';
import { FileVault } from '../infrastructure/files/file-vault';
import { AppShell } from './AppShell';

const projectRepository = new ProjectRepository(appDb);
const evidenceRepository = new EvidenceRepository(appDb);
const fileVault = new FileVault(appDb);
const documentEvidenceRepository = new DocumentEvidenceRepository(appDb);
const candidateReviewService = new CandidateReviewService(
  documentEvidenceRepository,
  evidenceRepository,
);

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <ProjectListPage repository={projectRepository} /> },
      {
        path: 'projects/new',
        element: (
          <NewProjectPage
            onCreate={async (project) => {
              await projectRepository.save(project);
            }}
          />
        ),
      },
      {
        path: 'projects/:projectId',
        element: (
          <ProjectDashboardRoute
            projectRepository={projectRepository}
            evidenceRepository={evidenceRepository}
            fileVault={fileVault}
            documentEvidenceRepository={documentEvidenceRepository}
          />
        ),
      },
      {
        path: 'projects/:projectId/data-room',
        element: (
          <ProjectDataRoomRoute
            projectRepository={projectRepository}
            vault={fileVault}
            evidenceRepository={evidenceRepository}
            documentRepository={documentEvidenceRepository}
            reviewService={candidateReviewService}
          />
        ),
      },
    ],
  },
]);
