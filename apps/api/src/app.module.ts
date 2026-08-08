import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { CredentialsModule } from './credentials/credentials.module';
import { EvidenceModule } from './evidence/evidence.module';
import { HealthModule } from './health/health.module';
import { LlmModule } from './llm/llm.module';
import { RecorderModule } from './recorder/recorder.module';
import { SpecsModule } from './specs/specs.module';
import { CompilerModule } from './compiler/compiler.module';
import { ExecutionsModule } from './executions/executions.module';
import { ProjectsModule } from './projects/projects.module';
import { ApplicationsModule } from './applications/applications.module';
import { EnvironmentsModule } from './environments/environments.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    CredentialsModule,
    EvidenceModule,
    HealthModule,
    ProjectsModule,
    ApplicationsModule,
    EnvironmentsModule,
    LlmModule,
    RecorderModule,
    SpecsModule,
    CompilerModule,
    ExecutionsModule,
  ],
})
export class AppModule {}
