import { Module } from '@nestjs/common';
import { RecorderController } from './recorder.controller';
import { RecorderService } from './recorder.service';
import { RecordingsService } from './recordings.service';

@Module({
  controllers: [RecorderController],
  providers: [RecorderService, RecordingsService],
  exports: [RecorderService, RecordingsService],
})
export class RecorderModule {}
