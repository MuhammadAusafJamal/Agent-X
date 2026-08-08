import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';

/** Global — the compiler, resolver, verifier, diagnoser, and healer all use it. */
@Global()
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
