import { z } from 'zod';

const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const boxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const clickSegmentSchema = z.object({
  imageUrl: z.string().min(1),
  points: z.array(pointSchema).min(1),
  box: boxSchema.optional(),
});

export const autoSegmentSchema = z.object({
  imageUrl: z.string().min(1),
});

export const semanticSegmentSchema = z.object({
  imageUrl: z.string().min(1),
  prompt: z.string().min(1),
});

export type ClickSegmentInput = z.infer<typeof clickSegmentSchema>;
export type AutoSegmentInput = z.infer<typeof autoSegmentSchema>;
export type SemanticSegmentInput = z.infer<typeof semanticSegmentSchema>;
