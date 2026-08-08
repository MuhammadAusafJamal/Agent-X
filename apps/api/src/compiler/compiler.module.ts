import { Module } from '@nestjs/common';
import { RecorderModule } from '../recorder/recorder.module';
import { SpecsModule } from '../specs/specs.module';
import { CompilerController } from './compiler.controller';
import { CompilerService } from './compiler.service';

@Module({
  imports: [RecorderModule, SpecsModule],
  controllers: [CompilerController],
  providers: [CompilerService],
  exports: [CompilerService],
})
export class CompilerModule {}
