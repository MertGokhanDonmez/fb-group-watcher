import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { extractGroupId } from '../../../shared/protocol.ts';
import { normalizeGroupUrl } from '../../../shared/facebook.ts';
import { pushConfigToAgent } from '../agent/hub.ts';
import {
  createGroup,
  deleteGroup,
  getGroupByFbId,
  listGroups,
  updateGroup,
} from '../repo/groups.ts';

const createSchema = z.object({
  url: z.string().min(1),
  name: z.string().min(1).optional(),
  dwellMs: z.number().int().min(2000).max(120_000).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  enabled: z.boolean().optional(),
  dailyActionCap: z.number().int().min(0).max(500).optional(),
});

const updateSchema = z
  .object({
    name: z.string().min(1),
    url: z.string().min(1),
    dwellMs: z.number().int().min(2000).max(120_000),
    priority: z.number().int().min(0).max(10),
    enabled: z.boolean(),
    dailyActionCap: z.number().int().min(0).max(500),
  })
  .partial()
  .strict();

const idParam = z.object({ id: z.coerce.number().int().positive() });

export const groupRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/groups', async () => listGroups());

  app.post('/api/groups', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Gecersiz grup', detail: parsed.error.flatten() });
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeGroupUrl(parsed.data.url);
    } catch {
      return reply.status(400).send({ error: 'Grup adresi cozulemedi' });
    }

    const fbGroupId = extractGroupId(normalizedUrl);
    if (!fbGroupId) {
      return reply
        .status(400)
        .send({ error: 'Adres bir Facebook grup adresi degil (facebook.com/groups/... bekleniyor)' });
    }
    if (getGroupByFbId(fbGroupId)) {
      return reply.status(409).send({ error: 'Bu grup zaten ekli' });
    }

    const group = createGroup({
      fbGroupId,
      name: parsed.data.name ?? fbGroupId,
      url: normalizedUrl,
      dwellMs: parsed.data.dwellMs ?? 8000,
      priority: parsed.data.priority ?? 1,
      enabled: parsed.data.enabled ?? true,
      dailyActionCap: parsed.data.dailyActionCap ?? 10,
    });
    pushConfigToAgent();
    return reply.status(201).send(group);
  });

  app.patch('/api/groups/:id', async (request, reply) => {
    const params = idParam.safeParse(request.params);
    const body = updateSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: 'Gecersiz istek' });
    }
    const patch = { ...body.data };
    if (patch.url) patch.url = normalizeGroupUrl(patch.url);

    const group = updateGroup(params.data.id, patch);
    if (!group) return reply.status(404).send({ error: 'Grup bulunamadi' });
    pushConfigToAgent();
    return group;
  });

  app.delete('/api/groups/:id', async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Gecersiz id' });
    if (!deleteGroup(params.data.id)) return reply.status(404).send({ error: 'Grup bulunamadi' });
    pushConfigToAgent();
    return reply.status(204).send();
  });
};
