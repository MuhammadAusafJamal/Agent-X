import { Module } from '@nestjs/common';
import { ResolverService } from './resolver.service';

@Module({
  providers: [ResolverService],
  exports: [ResolverService],
})
export class ResolverModule {}
