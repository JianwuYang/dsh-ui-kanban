import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { BoardIssue, JiraSettings, SyncMeta } from './types.ts'

/**
 * Local JSON cache for the synced board data. The dsh host is the only party
 * that talks to Jira/GitLab, so it is also the only party that persists the
 * synced issues. This module owns that on-disk store and exposes a tiny, typed
 * API keyed by project id.
 *
 * Layout (default `~/.dsh/kanban`, overridable via `KANBAN_DATA_DIR` or the
 * plugin's `dataDir` config):
 *   - projects/<id>/issues.json : `{ version, updatedAt, issues: BoardIssue[] }`
 *   - projects/<id>/meta.json   : `{ version, lastSyncedAt, projectKey, jql, ... }`
 *   - projects/<id>/links.json  : that project's GitLab <-> Jira links
 *
 * The store lives OUTSIDE the repo on purpose: it is real persistent data and
 * must never be treated as a throwaway artifact. Writes are atomic (temp file +
 * rename) so a crash mid-write never leaves a truncated cache.
 */

/** Resolve the effective data directory from config, env, or the default. */
export function resolveDataDir(configDir: string | undefined): string {
  if (configDir && configDir.trim()) return path.resolve(configDir.trim())
  const env = process.env.KANBAN_DATA_DIR?.trim()
  if (env) return path.resolve(env)
  return path.join(os.homedir(), '.dsh', 'kanban')
}

/** Jira ↔ GitLab link store: issue→jiraKeys, and issue→mr. */
export interface LinksFile {
  /** gitlabIssueIid (string) → Jira keys. */
  issueJira: Record<string, string[]>
  /** gitlabIssueIid (string) → mrIid (string). */
  issueMr: Record<string, string>
}

interface IssuesFile {
  version: number
  updatedAt: string
  issues: BoardIssue[]
}

export type StoredMeta = Omit<SyncMeta, 'configured'> & { version: number }

function projectDir(dataDir: string, id: string): string {
  return path.join(dataDir, 'projects', id)
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, file)
}

async function readJsonSafe<T>(file: string): Promise<T | null> {
  try {
    const raw = await readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Creates a data store bound to `dataDir`. */
export function createKanbanStore(dataDir: string) {
  if (!dataDir) throw new Error('kanban store requires a data directory')

  return {
    getDataDir(): string {
      return dataDir
    },

    async readIssues(projectId: string): Promise<BoardIssue[]> {
      const data = await readJsonSafe<IssuesFile>(path.join(projectDir(dataDir, projectId), 'issues.json'))
      return data?.issues ?? []
    },

    async writeIssues(projectId: string, issues: BoardIssue[]): Promise<void> {
      const payload: IssuesFile = { version: 1, updatedAt: new Date().toISOString(), issues }
      await atomicWrite(path.join(projectDir(dataDir, projectId), 'issues.json'), payload)
    },

    async readMeta(projectId: string): Promise<StoredMeta | null> {
      return readJsonSafe<StoredMeta>(path.join(projectDir(dataDir, projectId), 'meta.json'))
    },

    async writeMeta(projectId: string, partial: Partial<StoredMeta>): Promise<StoredMeta> {
      const metaFile = path.join(projectDir(dataDir, projectId), 'meta.json')
      const current = (await readJsonSafe<StoredMeta>(metaFile))
        ?? { version: 1, lastSyncedAt: null, issueCount: 0 }
      const next: StoredMeta = { ...current, ...partial, version: 1 }
      await atomicWrite(metaFile, next)
      return next
    },

    async readLinks(projectId: string): Promise<LinksFile> {
      const data = await readJsonSafe<LinksFile>(path.join(projectDir(dataDir, projectId), 'links.json'))
      return data?.issueJira && data.issueMr ? data : { issueJira: {}, issueMr: {} }
    },

    async writeLinks(projectId: string, links: LinksFile): Promise<void> {
      await atomicWrite(path.join(projectDir(dataDir, projectId), 'links.json'), links)
    },

    /** Best-effort removal of a project's data folder. */
    async removeProject(projectId: string): Promise<void> {
      try {
        await rm(projectDir(dataDir, projectId), { recursive: true, force: true })
      } catch {
        // Ignore cleanup failures — the registry no longer references it.
      }
    },

    /** Ensure the data directory exists (used at startup for diagnostics). */
    async ensure(): Promise<void> {
      await mkdir(dataDir, { recursive: true })
    },
  }
}

/** Jira section reader that tolerates a legacy flat shape / absent section. */
export function readJiraFromSettings(settings: AppSettingsLike | null): JiraSettings | null {
  const r = settings as { baseUrl?: string; jira?: JiraSettings } | null
  if (!r) return null
  if (r.jira) return r.jira
  if (r.baseUrl) return r as JiraSettings
  return null
}

/** Minimal structural view of AppSettings used by the legacy reader. */
export interface AppSettingsLike {
  jira?: JiraSettings
  gitlab?: { baseUrl?: string }
  localRepo?: { directory?: string }
}

/** Convenience re-export so consumers import storage + types in one go. */
export { existsSync }
