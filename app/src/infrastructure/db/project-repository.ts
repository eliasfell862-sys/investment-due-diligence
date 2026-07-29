import type { Project } from '../../domain/project/project';
import { projectSchema } from '../../domain/project/project.schema';
import type { AppDb } from './app-db';

export class ProjectRepository {
  private readonly db: AppDb;

  constructor(db: AppDb) {
    this.db = db;
  }

  async save(project: Project): Promise<Project> {
    const parsed = projectSchema.parse(project);
    const canonical: Project = {
      ...parsed,
      createdAt: new Date(parsed.createdAt).toISOString(),
      updatedAt: new Date(parsed.updatedAt).toISOString(),
    };

    await this.db.projects.put(canonical);
    return canonical;
  }

  async get(id: string): Promise<Project | undefined> {
    return this.db.projects.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.projects.delete(id);
    // Also clean up project-scoped localStorage
    const prefix = `dd-p-${id}-`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  }

  async list(): Promise<Project[]> {
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
}
