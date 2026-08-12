import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createRule, deleteRule, listRules, updateRule } from '../repo/rules.ts';

const keywordList = z.array(z.string().trim().min(1)).max(200);

/** Gecersiz regex kaydedilirse eslestirme her postta patlar; kayit aninda dogruluyoruz. */
const regexSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => {
      if (value === '') return true;
      try {
        new RegExp(value, 'iu');
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Gecersiz regex' },
  )
  .nullable();

const baseSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
  matchMode: z.enum(['any', 'all']),
  includeKeywords: keywordList,
  excludeKeywords: keywordList,
  regex: regexSchema,
  actionComment: z.boolean(),
  actionDm: z.boolean(),
  actionNotify: z.boolean(),
  requireApproval: z.boolean(),
  commentTemplateId: z.number().int().positive().nullable(),
  dmTemplateId: z.number().int().positive().nullable(),
  dailyCap: z.number().int().min(0).max(500),
  maxPostAgeMin: z.number().int().min(1).max(1440),
  maxDistanceKm: z.number().min(0.1).max(200).nullable(),
  priority: z.number().int().min(0).max(10),
  groupIds: z.array(z.number().int().positive()).max(100),
});

const createSchema = baseSchema.partial({
  enabled: true,
  matchMode: true,
  excludeKeywords: true,
  regex: true,
  actionComment: true,
  actionDm: true,
  actionNotify: true,
  requireApproval: true,
  commentTemplateId: true,
  dmTemplateId: true,
  dailyCap: true,
  maxPostAgeMin: true,
  maxDistanceKm: true,
  priority: true,
  groupIds: true,
});

const updateSchema = baseSchema.partial().strict();
const idParam = z.object({ id: z.coerce.number().int().positive() });

/** Yorum aksiyonu acikken sablon secilmemisse kural sessizce hicbir sey yapmaz. */
function missingTemplate(rule: {
  actionComment?: boolean;
  actionDm?: boolean;
  commentTemplateId?: number | null;
  dmTemplateId?: number | null;
}): string | null {
  if (rule.actionComment && !rule.commentTemplateId) return 'Yorum aksiyonu icin bir yorum sablonu secilmeli';
  if (rule.actionDm && !rule.dmTemplateId) return 'DM aksiyonu icin bir DM sablonu secilmeli';
  return null;
}

export const ruleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/rules', async () => listRules());

  app.post('/api/rules', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Gecersiz kural', detail: parsed.error.flatten() });
    }
    const input = {
      enabled: true,
      matchMode: 'any' as const,
      excludeKeywords: [],
      regex: null,
      actionComment: false,
      actionDm: false,
      actionNotify: true,
      requireApproval: true,
      commentTemplateId: null,
      dmTemplateId: null,
      dailyCap: 20,
      maxPostAgeMin: 30,
      maxDistanceKm: null,
      priority: 1,
      groupIds: [],
      ...parsed.data,
    };
    const problem = missingTemplate(input);
    if (problem) return reply.status(400).send({ error: problem });
    return reply.status(201).send(createRule(input));
  });

  app.patch('/api/rules/:id', async (request, reply) => {
    const params = idParam.safeParse(request.params);
    const body = updateSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: 'Gecersiz istek', detail: body.success ? undefined : body.error.flatten() });
    }
    const existing = listRules().find((rule) => rule.id === params.data.id);
    if (!existing) return reply.status(404).send({ error: 'Kural bulunamadi' });

    const problem = missingTemplate({ ...existing, ...body.data });
    if (problem) return reply.status(400).send({ error: problem });

    return updateRule(params.data.id, body.data);
  });

  app.delete('/api/rules/:id', async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Gecersiz id' });
    if (!deleteRule(params.data.id)) return reply.status(404).send({ error: 'Kural bulunamadi' });
    return reply.status(204).send();
  });
};
