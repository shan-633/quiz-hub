import { z } from 'zod';
export const columnFeedbackSchema = z
  .object({
    verdict: z.enum(['correct', 'incorrect', 'partial']),
    score: z.number().finite().nonnegative(),
    comment: z.string().max(10000),
    correctAnswer: z.string().max(20000).optional(),
  })
  .strict();
export const columnIdSchema = z.string().regex(/^[a-zA-Z0-9_:-]{1,180}$/);
export const rubricSchema = z
  .array(
    z
      .object({
        id: columnIdSchema,
        label: z.string().trim().min(1).max(200),
        max: z.number().finite().min(0).max(1000),
      })
      .strict(),
  )
  .min(2)
  .max(100);
export const teacherGradeSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    verdict: z.enum(['correct', 'incorrect', 'partial']).optional(),
    score: z.number().finite().nonnegative().optional(),
    correctAnswer: z.string().max(20000).optional(),
    comment: z.string().max(10000).optional(),
    items: z.record(columnIdSchema, columnFeedbackSchema).optional(),
    rubric: rubricSchema.optional(),
  })
  .strict();
export const selfGradeSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    verdict: z.enum(['correct', 'incorrect', 'partial']).optional(),
    score: z.number().finite().nonnegative().optional(),
    comment: z.string().max(10000).optional(),
    items: z
      .record(columnIdSchema, columnFeedbackSchema.omit({ correctAnswer: true }).strict())
      .optional(),
  })
  .strict();
