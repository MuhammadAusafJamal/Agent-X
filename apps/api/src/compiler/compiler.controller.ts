import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { TestSpecWithCurrentVersion } from '@agentx/shared';
import { CompilerService } from './compiler.service';

@Controller('recordings')
export class CompilerController {
  constructor(private readonly compiler: CompilerService) {}

  /** Recording → intent specification. One model call, one new spec. */
  @Post(':id/compile')
  @HttpCode(201)
  compile(@Param('id') id: string): Promise<TestSpecWithCurrentVersion> {
    return this.compiler.compile(id);
  }
}
