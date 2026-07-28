import { createBrowserRouter } from 'react-router-dom';
import { AnalysisWorkbench } from '../features/analysis/AnalysisWorkbench';
import { CompanyOverviewPage } from '../features/analysis/CompanyOverviewPage';
import { CompetitorsPage } from '../features/analysis/CompetitorsPage';
import { EquityPage } from '../features/analysis/EquityPage';
import { ExitPage } from '../features/analysis/ExitPage';
import { FinancialPage } from '../features/analysis/FinancialPage';
import { IndustryPage } from '../features/analysis/IndustryPage';
import { InvestmentDecisionPage } from '../features/analysis/InvestmentDecisionPage';
import { ProductPage } from '../features/analysis/ProductPage';
import { RiskAssessmentPage } from '../features/analysis/RiskAssessmentPage';
import { TeamAssessmentPage } from '../features/analysis/TeamAssessmentPage';
import { ValuationPage } from '../features/analysis/ValuationPage';
import { ReportExportPage } from '../features/reports/ReportExportPage';
import { DataManagementPage } from '../features/settings/DataManagementPage';
import { SystemStatusPage } from '../features/settings/SystemStatusPage';
import { ResearchPage } from '../features/research/ResearchPage';
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
      {
        path: 'projects/:projectId/analysis',
        element: <AnalysisWorkbench />,
        children: [
          { index: true, element: <CompanyOverviewPage /> },
          { path: 'company', element: <CompanyOverviewPage /> },
          { path: 'team', element: <TeamAssessmentPage /> },
          { path: 'industry', element: <IndustryPage /> },
          { path: 'competitors', element: <CompetitorsPage /> },
          { path: 'product', element: <ProductPage /> },
          { path: 'financial', element: <FinancialPage /> },
          { path: 'valuation', element: <ValuationPage /> },
          { path: 'equity', element: <EquityPage /> },
          { path: 'risk', element: <RiskAssessmentPage /> },
          { path: 'exit', element: <ExitPage /> },
          { path: 'decision', element: <InvestmentDecisionPage /> },
        ],
      },
      {
        path: 'projects/:projectId/report',
        element: <ReportExportPage />,
      },
      {
        path: 'projects/:projectId/settings',
        element: <DataManagementPage />,
      },
      {
        path: 'projects/:projectId/status',
        element: <SystemStatusPage />,
      },
      {
        path: 'projects/:projectId/research',
        element: <ResearchPage />,
      },
    ],
  },
]);
