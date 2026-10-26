import { Router } from 'express';

export const healthRouter = Router();

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: Vérifie que l'API répond
 *     tags:
 *       - Santé
 *     responses:
 *       200:
 *         description: API opérationnelle
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 */
healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});
