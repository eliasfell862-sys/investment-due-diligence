import { lazy } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AiAgentSettingsPage } from '../features/ai-agents/AiAgentSettingsPage';
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
import { lazyRouteElement } from './LazyRouteElement';

const analysisWorkbenchPage = lazy(() => import('../features/analysis/AnalysisWorkbench')
  .then(module => ({ default: module.AnalysisWorkbench })));
const companyOverviewPage = lazy(() => import('../features/analysis/CompanyOverviewPage')
  .then(module => ({ default: module.CompanyOverviewPage })));
const competitorsPage = lazy(() => import('../features/analysis/CompetitorsPage')
  .then(module => ({ default: module.CompetitorsPage })));
const equityPage = lazy(() => import('../features/analysis/EquityPage')
  .then(module => ({ default: module.EquityPage })));
const exitPage = lazy(() => import('../features/analysis/ExitPage')
  .then(module => ({ default: module.ExitPage })));
const financialPage = lazy(() => import('../features/analysis/FinancialPage')
  .then(module => ({ default: module.FinancialPage })));
const industryPage = lazy(() => import('../features/analysis/IndustryPage')
  .then(module => ({ default: module.IndustryPage })));
const investmentDecisionPage = lazy(() => import('../features/analysis/InvestmentDecisionPage')
  .then(module => ({ default: module.InvestmentDecisionPage })));
const productPage = lazy(() => import('../features/analysis/ProductPage')
  .then(module => ({ default: module.ProductPage })));
const riskAssessmentPage = lazy(() => import('../features/analysis/RiskAssessmentPage')
  .then(module => ({ default: module.RiskAssessmentPage })));
const teamAssessmentPage = lazy(() => import('../features/analysis/TeamAssessmentPage')
  .then(module => ({ default: module.TeamAssessmentPage })));
const aiReasoningPage = lazy(() => import('../features/analysis/AIReasoningPage')
  .then(module => ({ default: module.AIReasoningPage })));
const customFieldsPage = lazy(() => import('../features/analysis/CustomFieldsPage')
  .then(module => ({ default: module.CustomFieldsPage })));
const lboPage = lazy(() => import('../features/analysis/LBOPage')
  .then(module => ({ default: module.LBOPage })));
const valueBridgePage = lazy(() => import('../features/analysis/ValueBridgePage')
  .then(module => ({ default: module.ValueBridgePage })));
const qoePage = lazy(() => import('../features/analysis/QoEPage')
  .then(module => ({ default: module.QoEPage })));
const founderAssessmentPage = lazy(() => import('../features/analysis/FounderAssessmentPage')
  .then(module => ({ default: module.FounderAssessmentPage })));
const competitiveMapPage = lazy(() => import('../features/analysis/CompetitiveMapPage')
  .then(module => ({ default: module.CompetitiveMapPage })));
const dealMemoPage = lazy(() => import('../features/analysis/DealMemoPage')
  .then(module => ({ default: module.DealMemoPage })));
const contractLedgerPage = lazy(() => import('../features/analysis/ContractLedgerPage')
  .then(module => ({ default: module.ContractLedgerPage })));
const financingHistoryPage = lazy(() => import('../features/analysis/FinancingHistoryPage')
  .then(module => ({ default: module.FinancingHistoryPage })));
const procurementPage = lazy(() => import('../features/analysis/ProcurementPage')
  .then(module => ({ default: module.ProcurementPage })));
const salesAnalysisPage = lazy(() => import('../features/analysis/SalesAnalysisPage')
  .then(module => ({ default: module.SalesAnalysisPage })));
const valuationPage = lazy(() => import('../features/analysis/ValuationPage')
  .then(module => ({ default: module.ValuationPage })));
const reportExportPage = lazy(() => import('../features/reports/ReportExportPage')
  .then(module => ({ default: module.ReportExportPage })));
const dataManagementPage = lazy(() => import('../features/settings/DataManagementPage')
  .then(module => ({ default: module.DataManagementPage })));
const systemStatusPage = lazy(() => import('../features/settings/SystemStatusPage')
  .then(module => ({ default: module.SystemStatusPage })));
const researchPage = lazy(() => import('../features/research/ResearchPage')
  .then(module => ({ default: module.ResearchPage })));
const companySearchPage = lazy(() => import('../features/research/CompanySearchPage')
  .then(module => ({ default: module.CompanySearchPage })));
const smartAssessmentPage = lazy(() => import('../features/inference/SmartAssessmentPage')
  .then(module => ({ default: module.SmartAssessmentPage })));

const analysisWorkbenchElement = lazyRouteElement(analysisWorkbenchPage);
const companyOverviewElement = lazyRouteElement(companyOverviewPage);
const competitorsElement = lazyRouteElement(competitorsPage);
const equityElement = lazyRouteElement(equityPage);
const exitElement = lazyRouteElement(exitPage);
const financialElement = lazyRouteElement(financialPage);
const industryElement = lazyRouteElement(industryPage);
const investmentDecisionElement = lazyRouteElement(investmentDecisionPage);
const productElement = lazyRouteElement(productPage);
const riskAssessmentElement = lazyRouteElement(riskAssessmentPage);
const teamAssessmentElement = lazyRouteElement(teamAssessmentPage);
const aiReasoningElement = lazyRouteElement(aiReasoningPage);
const customFieldsElement = lazyRouteElement(customFieldsPage);
const lboElement = lazyRouteElement(lboPage);
const valueBridgeElement = lazyRouteElement(valueBridgePage);
const qoeElement = lazyRouteElement(qoePage);
const founderAssessmentElement = lazyRouteElement(founderAssessmentPage);
const competitiveMapElement = lazyRouteElement(competitiveMapPage);
const dealMemoElement = lazyRouteElement(dealMemoPage);
const contractLedgerElement = lazyRouteElement(contractLedgerPage);
const financingHistoryElement = lazyRouteElement(financingHistoryPage);
const procurementElement = lazyRouteElement(procurementPage);
const salesAnalysisElement = lazyRouteElement(salesAnalysisPage);
const valuationElement = lazyRouteElement(valuationPage);
const reportExportElement = lazyRouteElement(reportExportPage);
const dataManagementElement = lazyRouteElement(dataManagementPage);
const systemStatusElement = lazyRouteElement(systemStatusPage);
const researchElement = lazyRouteElement(researchPage);
const companySearchElement = lazyRouteElement(companySearchPage);
const smartAssessmentElement = lazyRouteElement(smartAssessmentPage);

const securitiesWorkbenchPage = lazy(() => import('../features/securities/SecuritiesWorkbenchWithCloudMigration')
  .then(module => ({ default: module.SecuritiesWorkbenchWithCloudMigration })));
const stockAnalysisPage = lazy(() => import('../features/securities/StockAnalysisPage')
  .then(module => ({ default: module.StockAnalysisPage })));
const fundAnalysisPage = lazy(() => import('../features/securities/FundAnalysisPage')
  .then(module => ({ default: module.FundAnalysisPage })));
const stockRecommendPage = lazy(() => import('../features/securities/StockRecommendPage')
  .then(module => ({ default: module.StockRecommendPage })));
const watchlistPage = lazy(() => import('../features/securities/WatchlistPage')
  .then(module => ({ default: module.WatchlistPage })));
const stockScreenerPage = lazy(() => import('../features/securities/StockScreenerPage')
  .then(module => ({ default: module.StockScreenerPage })));
const portfolioAllocationPage = lazy(() => import('../features/securities/PortfolioAllocationPage')
  .then(module => ({ default: module.PortfolioAllocationPage })));
const strategyLearningLabPage = lazy(() => import('../features/securities/StrategyLearningLabPage')
  .then(module => ({ default: module.StrategyLearningLabPage })));
const preMoveRadarPage = lazy(() => import('../features/securities/PreMoveRadarPage')
  .then(module => ({ default: module.PreMoveRadarPage })));
const liveTradingShadowPage = lazy(() => import('../features/securities/live-trading/LiveTradingShadowPage')
  .then(module => ({ default: module.LiveTradingShadowPage })));

const securitiesWorkbenchElement = lazyRouteElement(securitiesWorkbenchPage);
const stockAnalysisElement = lazyRouteElement(stockAnalysisPage);
const fundAnalysisElement = lazyRouteElement(fundAnalysisPage);
const stockRecommendElement = lazyRouteElement(stockRecommendPage);
const watchlistElement = lazyRouteElement(watchlistPage);
const stockScreenerElement = lazyRouteElement(stockScreenerPage);
const portfolioAllocationElement = lazyRouteElement(portfolioAllocationPage);
const strategyLearningElement = lazyRouteElement(strategyLearningLabPage);
const preMoveRadarElement = lazyRouteElement(preMoveRadarPage);
const liveTradingShadowElement = lazyRouteElement(liveTradingShadowPage);
const projectRepository = new ProjectRepository(appDb);
const evidenceRepository = new EvidenceRepository(appDb);
const fileVault = new FileVault(appDb);
const documentEvidenceRepository = new DocumentEvidenceRepository(appDb);
const candidateReviewService = new CandidateReviewService(
  documentEvidenceRepository,
  evidenceRepository,
);

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <ProjectListPage repository={projectRepository} /> },
      { path: 'securities', element: securitiesWorkbenchElement },
      { path: 'ai-agents', element: <AiAgentSettingsPage /> },
      { path: 'securities/stock/:code', element: stockAnalysisElement },
      { path: 'securities/fund/:code', element: fundAnalysisElement },
      { path: 'securities/recommend', element: stockRecommendElement },
      { path: 'securities/watchlist', element: watchlistElement },
      { path: 'securities/screener', element: stockScreenerElement },
      { path: 'securities/portfolio', element: portfolioAllocationElement },
      { path: 'securities/strategy-learning', element: strategyLearningElement },
      { path: 'securities/pre-move-radar', element: preMoveRadarElement },
      { path: 'securities/live-trading', element: liveTradingShadowElement },
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
        element: analysisWorkbenchElement,
        children: [
          { index: true, element: companyOverviewElement },
          { path: 'company', element: companyOverviewElement },
          { path: 'team', element: teamAssessmentElement },
          { path: 'industry', element: industryElement },
          { path: 'competitors', element: competitorsElement },
          { path: 'product', element: productElement },
          { path: 'financial', element: financialElement },
          { path: 'valuation', element: valuationElement },
          { path: 'equity', element: equityElement },
          { path: 'risk', element: riskAssessmentElement },
          { path: 'exit', element: exitElement },
          { path: 'decision', element: investmentDecisionElement },
          { path: 'sales', element: salesAnalysisElement },
          { path: 'procurement', element: procurementElement },
          { path: 'financing-history', element: financingHistoryElement },
          { path: 'contracts', element: contractLedgerElement },
          { path: 'ai-reasoning', element: aiReasoningElement },
          { path: 'custom-fields', element: customFieldsElement },
          { path: 'lbo', element: lboElement },
          { path: 'value-bridge', element: valueBridgeElement },
          { path: 'qoe', element: qoeElement },
          { path: 'founder', element: founderAssessmentElement },
          { path: 'competitive-map', element: competitiveMapElement },
          { path: 'deal-memo', element: dealMemoElement },
        ],
      },
      {
        path: 'projects/:projectId/report',
        element: reportExportElement,
      },
      {
        path: 'projects/:projectId/settings',
        element: dataManagementElement,
      },
      {
        path: 'projects/:projectId/status',
        element: systemStatusElement,
      },
      {
        path: 'projects/:projectId/research',
        element: researchElement,
      },
      {
        path: 'projects/:projectId/company-search',
        element: companySearchElement,
      },
      {
        path: 'projects/:projectId/smart-assessment',
        element: smartAssessmentElement,
      },
      {
        path: 'projects/:projectId/securities',
        element: securitiesWorkbenchElement,
      },
      {
        path: 'projects/:projectId/securities/stock/:code',
        element: stockAnalysisElement,
      },
      {
        path: 'projects/:projectId/securities/fund/:code',
        element: fundAnalysisElement,
      },
      {
        path: 'projects/:projectId/securities/recommend',
        element: stockRecommendElement,
      },
      {
        path: 'projects/:projectId/securities/watchlist',
        element: watchlistElement,
      },
      {
        path: 'projects/:projectId/securities/screener',
        element: stockScreenerElement,
      },
      {
        path: 'projects/:projectId/securities/portfolio',
        element: portfolioAllocationElement,
      },
      {
        path: 'projects/:projectId/securities/strategy-learning',
        element: strategyLearningElement,
      },
      {
        path: 'projects/:projectId/securities/pre-move-radar',
        element: preMoveRadarElement,
      },
      {
        path: 'projects/:projectId/securities/live-trading',
        element: liveTradingShadowElement,
      },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
