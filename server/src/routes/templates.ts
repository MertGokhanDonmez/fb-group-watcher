import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
} from '../repo/templates.ts';

const kindSchema = z.enum(['comment', 'dm']);

// En az bir varyant sart: sablonun tamami bosalirsa aksiyon bos metin gonderir.
const variantsSchema = z.array(z.string().trim().min(1)).min(1).max(20);

const createSchema = z.object({
  name: z.string().min(1),
  kind: kindSchema,
  variants: variantsSchema,
});

const updateSchema = z
  .object({ name: z.string().min(1), kind: kindSchema, variants: variantsSchema })
  .partial()
  .strict();

const idParam = z.object({ id: z.coerce.number().int().positive() });

export const templateRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/templates', async (request) => {
    const kind = kindSchema.safeParse((request.query as { kind?: string } | undefined)?.kind);
    return kind.success ? listTemplates(kind.data) : listTemplates();
  });

  app.post('/api/templates', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Gecersiz sablon', detail: parsed.error.flatten() });
    }
    return reply.status(201).send(createTemplate(parsed.data));
  });

  app.patch('/api/templates/:id', async (request, reply) => {
    const params = idParam.safeParse(request.params);
    const body = updateSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: 'Gecersiz istek' });
    }
    const template = updateTemplate(params.data.id, body.data);
    if (!template) return reply.status(404).send({ error: 'Sablon bulunamadi' });
    return template;
  });

  app.delete('/api/templates/:id', async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Gecersiz id' });
    if (!deleteTemplate(params.data.id)) return reply.status(404).send({ error: 'Sablon bulunamadi' });
    return reply.status(204).send();
  });
};
