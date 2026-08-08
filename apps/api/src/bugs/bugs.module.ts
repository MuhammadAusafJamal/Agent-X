import { Module } from '@nestjs/common';
import { BugsController } from './bugs.controller';
import { BugsService } from './bugs.service';
import { BugReporterService } from './bug-reporter.service';

/**
 * Reading bugs and filing them are separate concerns sharing one table: the
 * controller serves the tracker, `BugReporterService` is what the runner calls
 * when a failure is diagnosed as the application's fault.
 */
@Module({
  controllers: [BugsController],
  providers: [BugsService, BugReporterService],
  exports: [BugReporterService],
})
export class BugsModule {}
