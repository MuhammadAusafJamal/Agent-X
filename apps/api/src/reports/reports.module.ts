import { Global, Module } from '@nestjs/common';
import { ReportsService } from './reports.service';

/** Global — the runner writes one at the end of every run, the API serves it. */
@Global()
@Module({
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
