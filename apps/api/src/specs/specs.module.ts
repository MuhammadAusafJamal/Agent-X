import { Module } from '@nestjs/common';
import { SpecsController } from './specs.controller';
import { SpecsService } from './specs.service';

@Module({
  controllers: [SpecsController],
  providers: [SpecsService],
  exports: [SpecsService],
})
export class SpecsModule {}
