import { z } from 'zod';
import type { Block } from './model';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const text = z.string().max(100000);
const option = z.object({ id, text: z.string().max(5000) });
export const blockSchema: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ id, type: z.literal('paragraph'), text }),
    z.object({ id, type: z.literal('formula'), latex: z.string().max(10000) }),
    z.object({
      id,
      type: z.literal('image'),
      assetId: id.optional(),
      src: z
        .string()
        .regex(/^\/diagrams\/[a-z-]+\.svg$/)
        .optional(),
      alt: z.string().max(1000),
      caption: z.string().max(1000),
      width: z.number().min(10).max(100),
      intrinsicWidth: z.number().int().min(1).max(50000).optional(),
      intrinsicHeight: z.number().int().min(1).max(50000).optional(),
    }),
    z.object({
      id,
      type: z.literal('table'),
      headers: z.array(z.string().max(5000)).max(20),
      rows: z.array(z.array(z.string().max(5000)).max(20)).max(100),
    }),
    z.object({
      id,
      type: z.literal('group'),
      layout: z.enum(['stack', 'mediaAside']),
      children: z.array(blockSchema).max(50),
    }),
    z.object({
      id,
      type: z.literal('subquestion'),
      label: z.string().max(200),
      score: z.number().min(0).max(100),
      responseKind: z.enum(['blanks', 'single', 'multiple', 'open']),
      options: z.array(option).max(20).optional(),
      children: z.array(blockSchema).max(50),
    }),
  ]),
);
export const questionSchema = z.object({
  id,
  version: z.number().int().min(0),
  bankId: id,
  type: z.enum(['single', 'multiple', 'fill', 'experiment', 'reading', 'calculation']),
  title: z.string().max(300),
  score: z.number().min(0).max(1000),
  difficulty: z.string().max(50),
  tags: z.array(z.string().max(100)).max(20),
  content: z.array(blockSchema).max(100),
  options: z.array(option).max(20),
  blanks: z
    .array(
      z.object({
        id,
        label: z.string().max(200),
        score: z.number().min(0).max(100),
        kind: z.enum(['text', 'number', 'manual']),
        unit: z.string().max(100).optional(),
      }),
    )
    .max(100),
  solution: z
    .object({
      choices: z.array(id).max(20),
      blanks: z.record(
        id,
        z.object({
          accepted: z.array(z.string().max(1000)).max(30),
          tolerance: z.number().min(0).max(1e12).optional(),
          ignoreWhitespace: z.boolean().optional(),
        }),
      ),
      partChoices: z.record(id, z.array(id).max(20)).optional(),
      explanation: text,
    })
    .optional(),
  state: z.enum(['draft', 'published', 'archived']),
  source: z.string().max(1000).optional(),
  multipleScoring: z.enum(['exact', 'half']).optional(),
  allowedModes: z
    .array(z.enum(['text', 'drawing', 'photo']))
    .max(3)
    .optional(),
});
const responseShape = {
  choiceIds: z.array(id).max(20),
  blankValues: z.record(id, z.string().max(10000)),
  markdown: text,
  drawingPages: z
    .array(
      z.object({
        id,
        width: z.number().min(1).max(5000),
        height: z.number().min(1).max(10000),
        strokes: z
          .array(
            z.object({
              id,
              color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
              width: z.number().min(0.1).max(30),
              points: z
                .array(
                  z.object({
                    x: z.number().finite(),
                    y: z.number().finite(),
                    p: z.number().min(0).max(1),
                    t: z.number().finite(),
                  }),
                )
                .max(10000),
            }),
          )
          .max(3000),
        previewAssetId: id.optional(),
      }),
    )
    .max(20),
  imagePages: z
    .array(
      z.object({
        id,
        assetId: id,
        rotation: z.number().int().multipleOf(90).min(0).max(270),
        name: z.string().max(255),
      }),
    )
    .max(10),
};
export const answerSchema = z.object({
  ...responseShape,
  parts: z.record(id, z.object(responseShape)),
  flagged: z.boolean(),
});
export const librarySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(3000),
  chapter: z.string().max(100),
  accent: z.enum(['mechanics', 'electric', 'buoyancy', 'exam']).default('mechanics'),
  state: z.enum(['draft', 'published', 'archived']).default('draft'),
  minutes: z.number().int().min(1).max(600).default(30),
  timeLimitMinutes: z.number().int().min(1).max(600).optional(),
  enforceTimeLimit: z.boolean().optional(),
  items: z
    .array(
      z.object({
        questionId: id,
        version: z.number().int().positive(),
        score: z.number().positive().max(1000),
      }),
    )
    .max(200)
    .optional(),
});
