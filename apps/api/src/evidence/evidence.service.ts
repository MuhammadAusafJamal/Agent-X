import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { TypedConfigService } from '../config/typed-config.service';

/**
 * The evidence tree on disk.
 *
 * Artifact rows store paths **relative** to this root, so the whole directory
 * can be moved, zipped, or shipped without rewriting the database. Callers only
 * ever deal in relative paths; resolving them is this service's job, and it is
 * also the only place that checks a resolved path has not escaped the root.
 */
@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);
  private readonly root: string;

  constructor(config: TypedConfigService) {
    // Four levels up from `apps/api/src/evidence` — or `apps/api/dist/evidence`
    // once built — is the repo root, which is what a relative EVIDENCE_DIR is
    // anchored to, exactly like DATABASE_URL.
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
    this.root = path.resolve(repoRoot, config.get('EVIDENCE_DIR'));

    // Logged because a misconfigured root is otherwise invisible: runs pass,
    // evidence is written, and nobody notices it landed somewhere unexpected
    // until they go looking for a screenshot months later.
    this.logger.log(`Evidence root: ${this.root}`);

    // The default used to be `../../data/evidence` — relative to `apps/api`,
    // which is not what it is resolved against — so every screenshot, trace,
    // and video landed two directories *above* the project, outside the
    // checkout and outside `.gitignore`. The default is fixed, but an existing
    // `.env` still carries the old value, and that file is not ours to rewrite.
    // So the mistake announces itself rather than being discovered.
    if (!this.root.startsWith(repoRoot + path.sep)) {
      this.logger.warn(
        `EVIDENCE_DIR resolves outside the repository (${this.root}). ` +
          `If that is not deliberate, set EVIDENCE_DIR=data/evidence in your .env — ` +
          `it is resolved against the repo root, like DATABASE_URL.`,
      );
    }
  }

  get rootDir(): string {
    return this.root;
  }

  recordingDir(recordingId: string): string {
    return path.posix.join('recordings', recordingId);
  }

  /** Writes a file and returns its path relative to the evidence root. */
  async write(relPath: string, data: Buffer | string): Promise<string> {
    const absolute = this.resolve(relPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, data);
    return relPath;
  }

  async size(relPath: string): Promise<number | null> {
    try {
      const stat = await fs.stat(this.resolve(relPath));
      return stat.size;
    } catch {
      return null;
    }
  }

  /**
   * Turns a relative path into an absolute one, refusing anything that escapes
   * the evidence root. Artifact paths reach this from HTTP, so `../../.env` has
   * to be impossible rather than merely unlikely.
   */
  resolve(relPath: string): string {
    const absolute = path.resolve(this.root, relPath);
    const rootWithSep = this.root.endsWith(path.sep)
      ? this.root
      : this.root + path.sep;

    if (absolute !== this.root && !absolute.startsWith(rootWithSep)) {
      throw new Error(`Evidence path escapes the evidence root: ${relPath}`);
    }

    return absolute;
  }

  async removeDir(relPath: string): Promise<void> {
    try {
      await fs.rm(this.resolve(relPath), { recursive: true, force: true });
    } catch (error) {
      this.logger.warn(
        `Could not remove evidence at ${relPath}`,
        error as Error,
      );
    }
  }
}
