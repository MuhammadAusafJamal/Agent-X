import { Body, Controller, Post } from '@nestjs/common';
import {
  resetDataSchema,
  type ResetDataInput,
  type ResetDataResult,
} from '@agentx/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /**
   * Deletes every row in the database. Keeps the schema.
   *
   * `POST` rather than `DELETE` because it takes a body and addresses no
   * resource — there is no `/admin/data` to delete, only an operation to run.
   *
   * The body must carry `"confirm": "DELETE ALL DATA"` verbatim. That is the
   * whole access control, which is honest about what it is: this API has no
   * authentication, so the phrase exists to stop an accident, not an attacker.
   * The service additionally refuses outright when `NODE_ENV` is production.
   */
  @Post('reset')
  reset(
    @Body(new ZodValidationPipe(resetDataSchema)) body: ResetDataInput,
  ): Promise<ResetDataResult> {
    return this.admin.resetData(body);
  }
}
