import re

with open('src/features/reports/ReportExportPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Insert helper function at the start of loadAllData, after the opening brace
content = content.replace(
    'function loadAllData() {',
    'function loadAllData(projectId: string) {\n  const L = <T,>(m: string, g: string, fb: T): T => loadProjectWithFallback<T>(projectId, m, g, fb);'
)

# Replace all localStorage patterns with scoped helpers
pairs = [
    ("JSON.parse(localStorage.getItem('dd-company-overview') || '{}')", "L('company-overview','dd-company-overview',{}) as Record<string,unknown>"),
    ("JSON.parse(localStorage.getItem('dd-team-members') || '[]')", "L('team-members','dd-team-members',[]) as any[]"),
    ("JSON.parse(localStorage.getItem('dd-industry-v2') || localStorage.getItem('dd-industry') || '{}')", "L('industry','dd-industry-v2',{}) as Record<string,string>"),
    ("JSON.parse(localStorage.getItem('dd-competitors-v2') || localStorage.getItem('dd-competitors') || '[]')", "L('competitors','dd-competitors-v2',[]) as any[]"),
    ("JSON.parse(localStorage.getItem('dd-products-v2') || '[]')", "L('products','dd-products-v2',[]) as any[]"),
    ("JSON.parse(localStorage.getItem('dd-financial-v3') || localStorage.getItem('dd-financial-v2') || '{}')", "L('financials','dd-financial-v3',{}) as Record<string,string>"),
    ("JSON.parse(localStorage.getItem('dd-risk-items') || '[]')", "L('risk-items','dd-risk-items',[]) as any[]"),
    ("JSON.parse(localStorage.getItem('dd-quality') || '{}')", "L('quality','dd-quality',{}) as Record<string,string>"),
    ("JSON.parse(localStorage.getItem('dd-sales') || '[]')", "L('sales','dd-sales',[]) as any[]"),
    ("JSON.parse(localStorage.getItem('dd-procurement') || '[]')", "L('procurement','dd-procurement',[]) as any[]"),
    ("JSON.parse(localStorage.getItem('dd-financing-history') || '[]')", "L('financing-history','dd-financing-history',[]) as any[]"),
    ("JSON.parse(localStorage.getItem('dd-contracts') || '[]')", "L('contracts','dd-contracts',[]) as any[]"),
    ("JSON.parse(localStorage.getItem('dd-exit') || '{}')", "L('exit','dd-exit',{}) as Record<string,string>"),
    ("JSON.parse(localStorage.getItem('dd-valuation') || '{}')", "L('valuation','dd-valuation',{}) as Record<string,string>"),
    ("localStorage.getItem('dd-ip')", "L('ip','dd-ip','') as string"),
    ("localStorage.getItem('dd-rd')", "L('rd','dd-rd','') as string"),
    ("localStorage.getItem('dd-strategy')", "L('strategy','dd-strategy','growth') as string"),
    ("localStorage.getItem('dd-esop')", "L('esop','dd-esop','') as string"),
    ("localStorage.getItem('dd-invest')", "L('invest','dd-invest','') as string"),
    ("localStorage.getItem('dd-assumptions')", "L('assumptions','dd-assumptions','') as string"),
    ("localStorage.getItem('dd-bearcase')", "L('bearcase','dd-bearcase','') as string"),
    ("localStorage.getItem('dd-exit')", "L('exit','dd-exit','') as string"),
    ("localStorage.getItem('dd-quality')", "L('quality','dd-quality','{}') as string"),
]

for old, new in pairs:
    if old in content:
        content = content.replace(old, new)

# Fix the auto-score section to also save scoped
content = content.replace(
    "localStorage.setItem('dd-quality', JSON.stringify(quality));",
    "saveProjectData(projectId, 'quality', quality);"
)

# Fix the export function call to pass projectId
content = content.replace(
    'const d = useMemo(() => loadAllData(), [refreshKey]);',
    'const d = useMemo(() => loadAllData(projectId || ""), [refreshKey, projectId]);'
)

with open('src/features/reports/ReportExportPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('OK')
