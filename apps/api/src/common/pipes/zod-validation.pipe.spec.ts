import { HttpStatus } from '@nestjs/common';
import { createProjectSchema, createApplicationSchema } from '@agentx/shared';
import { ZodValidationPipe } from './zod-validation.pipe';
import { ValidationError } from '../errors';

describe('ZodValidationPipe', () => {
  it('returns the parsed value for a valid body', () => {
    const pipe = new ZodValidationPipe(createProjectSchema);

    expect(pipe.transform({ name: 'Checkout' })).toEqual({ name: 'Checkout' });
  });

  it('strips unknown keys instead of passing them through', () => {
    const pipe = new ZodValidationPipe(createProjectSchema);

    expect(pipe.transform({ name: 'Checkout', isAdmin: true })).toEqual({
      name: 'Checkout',
    });
  });

  it('throws a 400 naming the offending field', () => {
    const pipe = new ZodValidationPipe(createApplicationSchema);

    let thrown: ValidationError | undefined;

    try {
      pipe.transform({ projectId: 'p1', name: 'Shop', baseUrl: 'localhost' });
    } catch (error) {
      thrown = error as ValidationError;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    expect(thrown?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(thrown?.code).toBe('VALIDATION_FAILED');
    expect(thrown?.issues).toEqual([
      expect.objectContaining({ path: 'baseUrl' }),
    ]);
  });

  it('reports every invalid field at once, not just the first', () => {
    const pipe = new ZodValidationPipe(createApplicationSchema);

    try {
      pipe.transform({ name: '', baseUrl: 'nope' });
      fail('expected the pipe to reject');
    } catch (error) {
      const paths = (error as ValidationError).issues?.map(
        (issue) => issue.path,
      );
      expect(paths).toEqual(expect.arrayContaining(['projectId', 'baseUrl']));
    }
  });

  it('rejects a non-object body rather than coercing it', () => {
    const pipe = new ZodValidationPipe(createProjectSchema);

    expect(() => pipe.transform('a string')).toThrow(ValidationError);
    expect(() => pipe.transform(null)).toThrow(ValidationError);
  });
});
