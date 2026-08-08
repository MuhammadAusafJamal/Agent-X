import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NotFoundError } from '../common/errors';
import { EvidenceService } from './evidence.service';

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.yaml': 'text/plain; charset=utf-8',
  '.html': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.zip': 'application/zip',
};

@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  /**
   * Serves an evidence file read-only.
   *
   * The path comes straight from a URL, so `EvidenceService.resolve` rejects
   * anything that escapes the evidence root before a file is ever opened —
   * `/evidence/../../.env` has to be impossible, not merely unlikely.
   *
   * `.html` and `.yaml` are served as plain text on purpose: DOM snapshots are
   * captured from the application under test, and rendering one as HTML would
   * execute its scripts on our origin.
   */
  @Get('*relPath')
  serve(
    @Param('relPath') relPath: string | string[],
    @Res() res: Response,
  ): void {
    const joined = Array.isArray(relPath) ? relPath.join('/') : relPath;

    let absolute: string;

    try {
      absolute = this.evidence.resolve(joined);
    } catch {
      throw new NotFoundError('Evidence', joined);
    }

    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new NotFoundError('Evidence', joined);
    }

    res.setHeader(
      'content-type',
      CONTENT_TYPES[path.extname(absolute).toLowerCase()] ??
        'application/octet-stream',
    );
    // Evidence is immutable once written.
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('x-content-type-options', 'nosniff');

    fs.createReadStream(absolute).pipe(res);
  }
}
