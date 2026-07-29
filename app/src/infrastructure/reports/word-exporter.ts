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
  financials: [string, string][];
  riskMatrix: { category: string; residualRisk: string; light: string }[];
  exitReturns: { moic: string; irr: string };
  keyAssumptions: string[];
  reversalConditions: string[];
  charts: { title: string; image: ChartImage }[];
  extended?: Record<string, any>;
}

const RISK_LABELS: Record<string, string> = {};

function heading(text: string, level: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2 | typeof HeadingLevel.HEADING_3 = HeadingLevel.HEADING_1): Paragraph {
  return new Paragraph({
    heading: level,
    children: [new TextRun({ text, bold: true, size: level === HeadingLevel.HEADING_1 ? 44 : level === HeadingLevel.HEADING_2 ? 32 : 26 })],
    spacing: { before: level === HeadingLevel.HEADING_1 ? 400 : 300, after: 200 },
  });
}

function para(text: string, options: { bold?: boolean; size?: number; spacing?: number } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: options.bold, size: options.size ?? 22 })],
    spacing: { after: options.spacing ?? 120 },
  });
}

function sectionHeading(num: string, title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [
      new TextRun({ text: `${num}  `, bold: true, size: 28 }),
      new TextRun({ text: title, bold: true, size: 28 }),
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
          children: [para(h, { bold: true, size: 18 })],
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
    new Paragraph({ children: [new TextRun({ text: '机密文件', size: 20, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: '投资尽调报告', size: 56, bold: true })] }),
    new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: data.projectName, size: 36 })] }),
    new Paragraph({ spacing: { before: 600 }, children: [new TextRun({ text: `日期：${data.date}`, size: 22 })] }),
    new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: `投资判定：${data.decision}`, size: 22, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: '\n\n本文件包含机密信息，仅供投资委员会内部审阅。', size: 18, italics: true })] }),
  ];

  const tocSection = [
    heading('目录', HeadingLevel.HEADING_1),
    new TableOfContents('目录', { hyperlink: true, headingStyleRange: '1-3' }),
  ];

  const execSection = [
    sectionHeading('1', '执行摘要'),
    para(data.description || '未提供公司描述。'),
    para(`投资判定：${data.decision}`, { bold: true }),
    para(`综合评分：${data.compositeScore}  |  风险调整后：${data.riskAdjustedScore}`, { size: 20 }),
  ];

  const highlightsSection = [
    sectionHeading('2', '投资亮点与风险'),
    para('核心亮点', { bold: true, size: 24 }),
    ...data.highlights.map((h) => para(`  + ${h}`, { size: 20 })),
    new Paragraph({ spacing: { before: 200 } }),
    para('反面逻辑', { bold: true, size: 24 }),
    para(data.bearCase || '未提供反面逻辑。', { size: 20 }),
  ];

  const industrySection = [
    sectionHeading('3', '行业与市场'),
    simpleTable(
      ['指标', '数值'],
      [['总可寻址市场(TAM)', data.industry.tam], ['可服务市场(SAM)', data.industry.sam], ['可获取市场(SOM)', data.industry.som], ['市场增速', data.industry.growth]],
    ),
  ];

  const competitorSection = [
    sectionHeading('4', '竞品对比'),
    data.competitors.length > 0
      ? simpleTable(
          ['公司', '阶段', '市场份额', '差异化'],
          data.competitors.map((c) => [c.name, c.stage, c.share, c.diff]),
        )
      : para('未提供竞品数据。', { color: GRAY }),
  ];

  const teamSection = [
    sectionHeading('5', '团队与治理'),
    data.team.length > 0
      ? simpleTable(
          ['姓名', '职位', '背景'],
          data.team.map((t) => [t.name, t.role, t.background]),
        )
      : para('未提供团队数据。', { color: GRAY }),
  ];

  const financialSection = [
    sectionHeading('6', '财务分析'),
    simpleTable(
      ['指标', '数值'],
      data.financials,
    ),
  ];

  const riskSection = [
    sectionHeading('7', '风险评估'),
    data.riskMatrix.length > 0
      ? simpleTable(
          ['类别', '残余风险', '信号'],
          data.riskMatrix.map((r) => [RISK_LABELS[r.category] || r.category, r.residualRisk, r.light === 'Green' ? '绿' : r.light === 'Yellow' ? '黄' : r.light === 'Red' ? '红' : r.light]),
        )
      : para('未提供风险数据。', { color: GRAY }),
  ];

  const exitSection = [
    sectionHeading('8', '退出与回报'),
    simpleTable(
      ['指标', '数值'],
      [['MOIC', data.exitReturns.moic], ['IRR', data.exitReturns.irr]],
    ),
  ];

  const decisionSection = [
    sectionHeading('9', '投资判定与条件'),
    para('关键假设', { bold: true, size: 24 }),
    ...data.keyAssumptions.map((a) => para(`  + ${a}`, { size: 20 })),
    new Paragraph({ spacing: { before: 200 } }),
    para('结论反转条件', { bold: true, size: 24 }),
    ...data.reversalConditions.map((c) => para(`  - ${c}`, { size: 20 })),
  ];

  // Chart pages
  const chartSections: Paragraph[] = [];
  if (data.charts.length > 0) {
    chartSections.push(sectionHeading('10', '图表'));
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
    border: { top: { style: BorderStyle.SINGLE, size: 1 } },
    children: [new TextRun({
      text: '本报告仅供投资委员会内部审阅。所有数据来源和计算方法详见附录。本报告不构成投资建议。',
      size: 16, italics: true,
    })],
  });

  const doc = new Document({
    creator: '投资尽调模型',
    title: `尽调报告 — ${data.projectName}`,
    description: '一级市场投资尽调报告',
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
            children: [new TextRun({ text: `机密 — ${data.projectName}`, size: 16 })],
            alignment: AlignmentType.RIGHT,
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: '第 ', size: 16 }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16 }),
              new TextRun({ text: ' 页', size: 16 }),
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
