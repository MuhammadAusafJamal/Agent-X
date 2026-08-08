import { Module } from '@nestjs/common';
import { SpecsModule } from '../specs/specs.module';
import { HealingsController } from './healings.controller';
import { HealingsService } from './healings.service';

/** Approval writes a new `TestVersion`, which is `SpecsService`'s job alone. */
@Module({
  imports: [SpecsModule],
  controllers: [HealingsController],
  providers: [HealingsService],
})
export class HealingsModule {}
