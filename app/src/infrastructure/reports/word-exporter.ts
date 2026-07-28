import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  ImageRun, BorderStyle, PageBreak, TableOfContents,
  Header, Footer, PageNumber,
} from 'docx';
import type { ChartImage } from '../charts/chart-renderer';

export interface ReportData {
  projectName: string;
  date: string;
  decision: string;
  compositeScore: string;
  riskAdjustedScore: string;
  highlights: string[];
  bearCase: string;
  description: string;
  industry: { tam: string; sam: string; som: string; growth: string };
  competitors: { name: string; stage: string; share: string; diff: string }[];
  team: { name: string; role: string; background: string }[];
  financials: Record<string, string>;
  riskMatrix: { category: string; residualRisk: string; light: string }[];
  exitReturns: { moic: string; irr: string };
  keyAssumptions: string[];
  reversalConditions: string[];
  charts: { title: string; image: ChartImage }[];
}

const NAVY = '123A52';
const TEAL = '16766F';
const GRAY = '86868B';

function heading(text: string, level: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2 | typeof HeadingLevel.HEADING_3 = HeadingLevel.HEADING_1): Paragraph {
  return new Paragraph({
    heading: level,
    children: [new TextRun({ text, bold: true, color: NAVY, size: level === HeadingLevel.HEADING_1 ? 44 : level === HeadingLevel.HEADING_2 ? 32 : 26 })],
    spacing: { before: level === HeadingLevel.HEADING_1 ? 400 : 300, after: 200 },
  });
}

function para(text: string, options: { bold?: boolean; color?: string; size?: number; spacing?: number } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: options.bold, color: options.color ?? '1D1D1F', size: options.size ?? 22 })],
    spacing: { after: options.spacing ?? 120 },
  });
}

function sectionHeading(num: string, title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [
      new TextRun({ text: `${num}  `, color: TEAL, bold: true, size: 28 }),
      new TextRun({ text: title, bold: true, color: NAVY, size: 28 }),
    ],
    spacing: { before: 400, after: 200 },
  });
}

function simpleTable(headers: string[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h) => new TableCell({
          children: [para(h, { bold: true, color: '#fff', size: 18 })],
          shading: { fill: NAVY },
          width: { size: 100 / headers.length, type: WidthType.PERCENTAGE },
        })),
      }),
      ...rows.map((row) => new TableRow({
        children: row.map((cell) => new TableCell({
          children: [para(cell, { size: 18 })],
          width: { size: 100 / headers.length, type: WidthType.PERCENTAGE },
        })),
      })),
    ],
  });
}

export async function generateWordReport(data: ReportData): Promise<Blob> {
  const coverSection = [
    new Paragraph({ spacing: { before: 3000 } }),
    new Paragraph({ children: [new TextRun({ text: 'CONFIDENTIAL', color: GRAY, size: 20, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: 'Investment Due Diligence Report', color: NAVY, size: 56, bold: true })] }),
    new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: data.projectName, color: TEAL, size: 36 })] }),
    new Paragraph({ spacing: { before: 600 }, children: [new TextRun({ text: `Date: ${data.date}`, color: GRAY, size: 22 })] }),
    new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: `Decision: ${data.decision}`, color: data.decision.includes('Recommend') || data.decision.includes('Invest') ? TEAL : '#9c3f36', size: 22, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: '\n\nThis document contains confidential information for investment committee review only.', color: GRAY, size: 18, italics: true })] }),
  ];

  const tocSection = [
    heading('Table of Contents', HeadingLevel.HEADING_1),
    new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }),
  ];

  const execSection = [
    sectionHeading('1', 'Executive Summary'),
    para(data.description || 'No company description provided.'),
    para(`Investment Decision: ${data.decision}`, { bold: true, color: TEAL }),
    para(`Composite Score: ${data.compositeScore}  |  Risk-Adjusted: ${data.riskAdjustedScore}`, { size: 20 }),
  ];

  const highlightsSection = [
    sectionHeading('2', 'Investment Highlights & Risks'),
    para('Key Highlights', { bold: true, size: 24 }),
    ...data.highlights.map((h) => para(`  + ${h}`, { size: 20 })),
    new Paragraph({ spacing: { before: 200 } }),
    para('Bear Case', { bold: true, size: 24, color: '#9c3f36' }),
    para(data.bearCase || 'No bear case provided.', { size: 20 }),
  ];

  const industrySection = [
    sectionHeading('3', 'Industry & Market'),
    simpleTable(
      ['Metric', 'Value'],
      [['TAM', data.industry.tam], ['SAM', data.industry.sam], ['SOM', data.industry.som], ['Growth Rate', data.industry.growth]],
    ),
  ];

  const competitorSection = [
    sectionHeading('4', 'Competitor Comparison'),
    data.competitors.length > 0
      ? simpleTable(
          ['Company', 'Stage', 'Market Share', 'Differentiation'],
          data.competitors.map((c) => [c.name, c.stage, c.share, c.diff]),
        )
      : para('No competitor data provided.', { color: GRAY }),
  ];

  const teamSection = [
    sectionHeading('5', 'Team & Governance'),
    data.team.length > 0
      ? simpleTable(
          ['Name', 'Role', 'Background'],
          data.team.map((t) => [t.name, t.role, t.background]),
        )
      : para('No team data provided.', { color: GRAY }),
  ];

  const financialSection = [
    sectionHeading('6', 'Financial Analysis'),
    simpleTable(
      ['Metric', 'Value'],
      Object.entries(data.financials).filter(([, v]) => v).map(([k, v]) => [k, v]),
    ),
  ];

  const riskSection = [
    sectionHeading('7', 'Risk Assessment'),
    data.riskMatrix.length > 0
      ? simpleTable(
          ['Category', 'Residual Risk', 'Signal'],
          data.riskMatrix.map((r) => [r.category, r.residualRisk, r.light]),
        )
      : para('No risk data provided.', { color: GRAY }),
  ];

  const exitSection = [
    sectionHeading('8', 'Exit & Returns'),
    simpleTable(
      ['Metric', 'Value'],
      [['MOIC', data.exitReturns.moic], ['IRR', data.exitReturns.irr]],
    ),
  ];

  const decisionSection = [
    sectionHeading('9', 'Investment Decision & Conditions'),
    para('Key Assumptions', { bold: true, size: 24 }),
    ...data.keyAssumptions.map((a) => para(`  + ${a}`, { size: 20 })),
    new Paragraph({ spacing: { before: 200 } }),
    para('Reversal Conditions', { bold: true, size: 24, color: '#9c3f36' }),
    ...data.reversalConditions.map((c) => para(`  - ${c}`, { size: 20 })),
  ];

  // Chart pages
  const chartSections: Paragraph[] = [];
  if (data.charts.length > 0) {
    chartSections.push(sectionHeading('10', 'Charts & Visualizations'));
    for (const chart of data.charts) {
      if (chart.image) {
        chartSections.push(new Paragraph({
          children: [new TextRun({ text: chart.title, bold: true, size: 24, color: NAVY })],
          spacing: { before: 400, after: 200 },
        }));
        // Extract base64 data from dataUrl and convert to Uint8Array
        const base64 = chart.image.dataUrl.split(',')[1];
        if (base64) {
          const binaryStr = atob(base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
          chartSections.push(new Paragraph({
            children: [new ImageRun({
              data: bytes,
              transformation: { width: 500, height: 300 },
              type: 'png',
            })],
            alignment: AlignmentType.CENTER,
          }));
        }
      }
    }
  }

  const disclaimer = new Paragraph({
    spacing: { before: 600 },
    border: { top: { style: BorderStyle.SINGLE, size: 1, color: GRAY } },
    children: [new TextRun({
      text: 'This report is prepared for internal investment committee review. All data sources and calculation methodologies are documented in the appendices. This does not constitute investment advice.',
      color: GRAY, size: 16, italics: true,
    })],
  });

  const doc = new Document({
    creator: 'Investment Due Diligence Model',
    title: `Due Diligence Report — ${data.projectName}`,
    description: 'Investment Due Diligence Report',
    sections: [{
      properties: {
        page: {
          margin: { top: 1200, bottom: 1200, left: 1440, right: 1440 },
          size: { width: 12240, height: 15840 }, // A4
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: `CONFIDENTIAL — ${data.projectName}`, color: GRAY, size: 16 })],
            alignment: AlignmentType.RIGHT,
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: 'Page ', color: GRAY, size: 16 }),
              new TextRun({ children: [PageNumber.CURRENT], color: GRAY, size: 16 }),
            ],
            alignment: AlignmentType.CENTER,
          })],
        }),
      },
      children: [
        ...coverSection,
        new Paragraph({ children: [new PageBreak()] }),
        ...tocSection,
        new Paragraph({ children: [new PageBreak()] }),
        ...execSection,
        ...highlightsSection,
        new Paragraph({ children: [new PageBreak()] }),
        ...industrySection,
        ...competitorSection,
        new Paragraph({ children: [new PageBreak()] }),
        ...teamSection,
        ...financialSection,
        new Paragraph({ children: [new PageBreak()] }),
        ...riskSection,
        ...exitSection,
        new Paragraph({ children: [new PageBreak()] }),
        ...decisionSection,
        ...chartSections,
        disclaimer,
      ],
    }],
  });

  return Packer.toBlob(doc);
}
