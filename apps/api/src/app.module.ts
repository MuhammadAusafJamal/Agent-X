import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { CredentialsModule } from './credentials/credentials.module';
import { HealthModule } from './health/health.module';
import { ProjectsModule } from './projects/projects.module';
import { ApplicationsModule } from './applications/applications.module';
import { EnvironmentsModule } from './environments/environments.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    CredentialsModule,
    HealthModule,
    ProjectsModule,
    ApplicationsModule,
    EnvironmentsModule,
  ],
})
export class AppModule {}
