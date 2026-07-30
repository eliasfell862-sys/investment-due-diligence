import { evaluateRisk } from './src/engines/risk/evaluate-risk.ts';
import { evaluateDecision } from './src/engines/decision/evaluate-decision.ts';

const pid = 'test123';
const pkey = (m) => `dd-p-${pid}-${m}`;

// Simulate AI extraction output
localStorage.setItem(pkey('company-overview'), JSON.stringify({name:'面壁智能',description:'端侧大模型公司',founded:'2022-08'}));
localStorage.setItem(pkey('team-members'), JSON.stringify([{name:'李大海',role:'CEO',background:'前知乎CTO，北大数学系，14年管理经验'},{name:'曾国洋',role:'CTO',background:'清华本硕，AI顶会多篇'}]));
localStorage.setItem(pkey('financials'), JSON.stringify({revenue:'10375',grossProfit:'5000',netIncome:'-2000',grossMargin:'48.2',revenue2025:'10375'}));
localStorage.setItem(pkey('industry'), JSON.stringify({tam:'50000000',growthRate:'35',chainMid:'端侧AI'}));
localStorage.setItem(pkey('products'), JSON.stringify([{name:'MiniCPM',stage:'已发布'}]));
localStorage.setItem(pkey('exit'), JSON.stringify({exitValue:'500000',ownershipPct:'8',holdingYears:'5',moic:'3.2',irr:'0.26'}));
localStorage.setItem(pkey('sales'), JSON.stringify([{name:'人民法院',revenue2025:'3276'},{name:'花瓣云',revenue2025:'1975'},{name:'华为',revenue2025:'1164'},{name:'东信',revenue2025:'1899'}]));

const quality = {
  teamAndGovernance: '55', marketAndIndustry: '75', productAndTechnology: '52',
  commercializationAndGrowth: '48', financialAndCashFlow: '55', valuationAndReturn: '55',
};
console.log('Quality:', quality);

// Test risk engine
try {
  const rr = evaluateRisk({
    version:'1', asOfDate:'2026-07-30', riskItems:[],
    fatalFlaws: [
      {fatalFlawId:'material_data_or_business_fraud',status:'clear',evidenceRefs:[]},
      {fatalFlawId:'core_ownership_or_license_unclear',status:'clear',evidenceRefs:[]},
      {fatalFlawId:'irremediable_major_illegality',status:'clear',evidenceRefs:[]},
      {fatalFlawId:'business_model_unverifiable',status:'clear',evidenceRefs:[]},
      {fatalFlawId:'pre_close_cash_break',status:'clear',evidenceRefs:[]},
      {fatalFlawId:'founder_integrity_failure',status:'clear',evidenceRefs:[]},
    ],
  });
  console.log('Risk:', rr.status, rr.status==='ok'?`penalty=${rr.value.overall.riskPenalty}`:'BLOCKED');
} catch(e) { console.error('Risk CRASH:', e.message); }

// Test decision engine
try {
  const dr = evaluateDecision({
    version:'1', strategy:'growth', qualityScores:quality,
    fatalOutcome:'none', notCurableByClause:false,
    returnMetrics: {targetIrr:'0.25',targetMoic:'3',baseCaseIrr:'0.26',baseCaseMoic:'3.2',permanentLossProbabilityLower:'0.05',permanentLossProbabilityUpper:'0.2'},
    keyAssumptions:[], bearCaseArguments:[],
    riskPenalty:'3', overallResidualRisk:'0.15',
  });
  console.log('Decision:', dr.status, dr.status==='ok'?`tier=${dr.value.tier} score=${dr.value.compositeScore}`:'BLOCKED');
  if (dr.status !== 'ok') console.log('Issues:', dr.issues?.map(i=>i.code));
} catch(e) { console.error('Decision CRASH:', e.message); }

// Cleanup
for (const m of ['company-overview','team-members','financials','industry','products','exit','sales']) {
  localStorage.removeItem(pkey(m));
}
