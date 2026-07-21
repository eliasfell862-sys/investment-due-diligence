import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import type { InvestmentStrategy, Project } from '../../domain/project/project';
import type { IndustryTemplateId } from '../../domain/templates/industry-template';

interface NewProjectFormValues {
  name: string;
  strategy: InvestmentStrategy;
  templates: IndustryTemplateId[];
}

interface NewProjectPageProps {
  onCreate: (project: Project) => Promise<void>;
}

const templateOptions: ReadonlyArray<{
  id: IndustryTemplateId;
  label: string;
  description: string;
}> = [
  { id: 'saas', label: 'SaaS / 软件', description: '订阅、留存与单位经济模型' },
  { id: 'consumer', label: '消费品', description: '品牌、渠道与复购质量' },
  { id: 'hardtech_manufacturing', label: '硬科技 / 制造', description: '产能、良率与供应链壁垒' },
];

export function NewProjectPage({ onCreate }: NewProjectPageProps) {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewProjectFormValues>({
    defaultValues: {
      name: '',
      strategy: 'growth',
      templates: [],
    },
  });

  const submitProject = handleSubmit(async (values) => {
    const timestamp = new Date().toISOString();
    await onCreate({
      id: crypto.randomUUID(),
      name: values.name.trim(),
      status: 'draft',
      currency: 'CNY',
      amountUnit: 'ten_thousand',
      createdAt: timestamp,
      updatedAt: timestamp,
      dealProfile: {
        strategy: values.strategy,
        investmentAmount: '0',
        targetOwnershipPct: '10',
        targetIrrPct: '25',
        targetMoic: '3',
        holdingPeriodYears: 5,
        industryTemplateIds: values.templates,
      },
    });
    navigate('/');
  });

  return (
    <section className="page new-project-page">
      <Link className="back-link" to="/">← 返回项目</Link>
      <header className="form-header">
        <p className="eyebrow">New Mandate / 新建档案</p>
        <h1>建立尽调项目</h1>
        <p className="page-intro">定义交易阶段并组合行业框架，作为后续判断的统一起点。</p>
      </header>

      <form className="project-form" onSubmit={submitProject} noValidate>
        <div className="form-section">
          <div className="section-number" aria-hidden="true">01</div>
          <div className="form-section-content">
            <div className="section-heading">
              <h2>项目概要</h2>
              <p>用于识别项目与设定基础投资语境。</p>
            </div>
            <div className="form-grid">
              <div className="field field-wide">
                <label htmlFor="project-name">项目名称</label>
                <input
                  id="project-name"
                  type="text"
                  placeholder="例如：硬件 SaaS 示例"
                  aria-invalid={errors.name ? 'true' : 'false'}
                  {...register('name', { required: '请输入项目名称' })}
                />
                {errors.name && <p className="field-error" role="alert">{errors.name.message}</p>}
              </div>
              <div className="field field-wide">
                <label htmlFor="investment-strategy">投资阶段</label>
                <select id="investment-strategy" {...register('strategy')}>
                  <option value="vc_early">早期 VC</option>
                  <option value="growth">成长期</option>
                  <option value="pe_buyout">PE / 并购</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <fieldset className="form-section template-section">
          <legend className="visually-hidden">行业模板（可组合）</legend>
          <div className="section-number" aria-hidden="true">02</div>
          <div className="form-section-content">
            <div className="section-heading">
              <h2>行业模板（可组合）</h2>
              <p>至少选择一个，可叠加形成更贴近交易实质的框架。</p>
            </div>
            <div className="template-grid">
              {templateOptions.map((template) => (
                <label className="template-option" key={template.id}>
                  <input
                    type="checkbox"
                    value={template.id}
                    aria-label={template.label}
                    {...register('templates', { required: '请至少选择一个行业模板' })}
                  />
                  <span className="template-check" aria-hidden="true">✓</span>
                  <span>
                    <strong>{template.label}</strong>
                    <small>{template.description}</small>
                  </span>
                </label>
              ))}
            </div>
            {errors.templates && <p className="field-error" role="alert">{errors.templates.message}</p>}
          </div>
        </fieldset>

        <div className="form-actions">
          <p>项目创建后仍可调整以上设置。</p>
          <button className="button button-primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? '正在创建…' : '创建项目'}
          </button>
        </div>
      </form>
    </section>
  );
}
