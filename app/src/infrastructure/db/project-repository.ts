import type { Project } from '../../domain/project/project';
import { projectSchema } from '../../domain/project/project.schema';
import type { AppDb } from './app-db';

export class ProjectRepository {
  private readonly db: AppDb;

  constructor(db: AppDb) {
    this.db = db;
  }

  async save(project: Project): Promise<void> {
    await this.db.projects.put(projectSchema.parse(project));
  }

  async get(id: string): Promise<Project | undefined> {
    return this.db.projects.get(id);
  }

  async list(): Promise<Project[]> {
    return this.db.projects.orderBy('updatedAt').reverse().toArray();
  }
}
