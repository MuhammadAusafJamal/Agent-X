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
    // EVIDENCE_DIR is relative to the repo root, like DATABASE_URL.
    this.root = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      config.get('EVIDENCE_DIR'),
    );
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
