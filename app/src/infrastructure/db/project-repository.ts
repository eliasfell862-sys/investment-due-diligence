import type { Project } from '../../domain/project/project';
import { projectSchema } from '../../domain/project/project.schema';
import type { AppDb } from './app-db';
import { CloudProjectRepository } from '../cloud/cloud-project-repository';
import { getSupabaseClient } from '../cloud/supabase-client';

/**
 * 尽调项目仓库 —— 登录感知双模式：
 * - 已登录（Supabase 会话存在）→ 读写云端 projects 表（RLS 按用户隔离）
 * - 未登录 → 读写本地 IndexedDB
 * 登录后可用 migrateLocalProjectsToCloud() 把本地项目一次性迁到云端。
 */
export class ProjectRepository {
  private readonly db: AppDb;
  private readonly cloud: CloudProjectRepository;

  constructor(db: AppDb) {
    this.db = db;
    this.cloud = new CloudProjectRepository();
  }

  private async cloudActive(): Promise<boolean> {
    try {
      const client = getSupabaseClient();
      const { data: { session } } = await client.auth.getSession();
      return Boolean(session?.user);
    } catch {
      return false;
    }
  }

  async save(project: Project): Promise<Project> {
    const parsed = projectSchema.parse(project);
    const canonical: Project = {
      ...parsed,
      createdAt: new Date(parsed.createdAt).toISOString(),
      updatedAt: new Date(parsed.updatedAt).toISOString(),
    };

    if (await this.cloudActive()) {
      await this.cloud.save(canonical);
      return canonical;
    }
    await this.db.projects.put(canonical);
    return canonical;
  }

  async get(id: string): Promise<Project | undefined> {
    if (await this.cloudActive()) return this.cloud.get(id);
    return this.db.projects.get(id);
  }

  async delete(id: string): Promise<void> {
    if (await this.cloudActive()) {
      await this.cloud.delete(id);
    } else {
      await this.db.projects.delete(id);
    }
    this.cleanupLocalStorage(id);
  }

  async list(): Promise<Project[]> {
    if (await this.cloudActive()) return this.cloud.list();
    return this.listLocal();
  }

  /** 是否处于云端模式（已登录且 Supabase 可用）。 */
  async isCloudActive(): Promise<boolean> {
    return this.cloudActive();
  }

  /** 把本地 IndexedDB 项目迁移到云端（需已登录），返回迁移条数。 */
  async migrateLocalProjectsToCloud(): Promise<number> {
    if (!(await this.cloudActive())) return 0;
    const local = await this.listLocal();
    let migrated = 0;
    for (const project of local) {
      await this.cloud.save(project);
      migrated += 1;
    }
    return migrated;
  }

  private async listLocal(): Promise<Project[]> {
    const projects = await this.db.projects
      .orderBy('updatedAt')
      .reverse()
      .toArray();

    return projects.sort((left, right) => {
      const newestFirst =
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (newestFirst !== 0) return newestFirst;

      // Equal timestamps use ascending project id as a stable tie-breaker.
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    });
  }

  private cleanupLocalStorage(id: string): void {
    // Also clean up project-scoped localStorage
    const prefix = `dd-p-${id}-`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  }
}
