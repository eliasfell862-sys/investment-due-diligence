/**
 * 尽调项目的 Supabase 云端仓库。
 *
 * projects 表（见 supabase/migrations/202608070008_project_cloud.sql）按
 * auth.uid() 做 RLS 隔离，本仓库直接用登录会话读写，full Project 对象存 payload
 * jsonb，name/status/updated_at 列为查询/排序用。
 */
import type { Project } from '../../domain/project/project';
import { getSupabaseClient } from './supabase-client';

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  status: string;
  updated_at: string;
  payload: Project;
}

function normalize(row: ProjectRow | undefined): Project | undefined {
  if (!row?.payload) return undefined;
  return row.payload;
}

export class CloudProjectRepository {
  async save(project: Project): Promise<Project> {
    const client = getSupabaseClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('未登录，无法保存到云端');

    const { error } = await client.from('projects').upsert({
      id: project.id,
      user_id: user.id,
      name: project.name,
      status: project.status,
      updated_at: project.updatedAt,
      payload: project,
    }, { onConflict: 'id' });
    if (error) throw error;
    return project;
  }

  async get(id: string): Promise<Project | undefined> {
    const client = getSupabaseClient();
    const { data, error } = await client.from('projects').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return normalize(data as ProjectRow | undefined);
  }

  async delete(id: string): Promise<void> {
    const client = getSupabaseClient();
    const { error } = await client.from('projects').delete().eq('id', id);
    if (error) throw error;
  }

  async list(): Promise<Project[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data as ProjectRow[] | null ?? [])
      .map(normalize)
      .filter((p): p is Project => Boolean(p));
  }
}
