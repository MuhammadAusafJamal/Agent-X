import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * Maintenance operations that act on the deployment rather than on a resource.
 *
 * Its own module, and last in the import list, so that "what can wipe this
 * database" is answerable by reading one directory.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
