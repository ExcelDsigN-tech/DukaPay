import { Router, type Request, type Response } from 'express';
import { agentFloatService } from '../services/agentFloatService.js';
import { requireJwtAuth } from '../middleware/jwtAuth.js';
import { requireRole } from '../middleware/rbac.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';
import {
  emptyAgentBodySchema,
  emptyAgentParamsSchema,
  emptyAgentQuerySchema,
  floatTransferIdParamsSchema,
  initiateFloatTransferBodySchema,
  pairLimitsQuerySchema,
  setPairLimitsBodySchema,
} from '../schemas/agentSchemas.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../errors/AppError.js';

const router = Router();

/**
 * @swagger
 * /agents/float-transfer:
 *   post:
 *     summary: Initiate a new agent-to-agent float transfer
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fromAgent, toAgent, amount]
 *             properties:
 *               fromAgent:
 *                 type: string
 *               toAgent:
 *                 type: string
 *               amount:
 *                 type: number
 *                 description: Transfer amount in whole tokens (e.g. USDC), up to 7 decimal places
 *               reason:
 *                 type: string
 *     responses:
 *       201:
 *         description: Float transfer initiated.
 *       400:
 *         description: Invalid request parameters.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden.
 */
router.post(
  '/float-transfer',
  requireJwtAuth,
  validateParams(emptyAgentParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  validateBody(initiateFloatTransferBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { fromAgent, toAgent, amount, reason } = req.body;
    const publicKey = (req as { user?: { publicKey?: string } }).user?.publicKey;
    const role = (req as { user?: { role?: string } }).user?.role;

    const result = await agentFloatService.initiateTransfer({
      fromAgent,
      toAgent,
      amount,
      reason,
      createdBy: publicKey!,
      userRole: role,
    });

    res.status(201).json({ success: true, data: result });
  }),
);

/**
 * @swagger
 * /agents/float-transfer/{id}/approve:
 *   post:
 *     summary: Approve a pending float transfer
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Float transfer approved.
 *       400:
 *         description: Invalid transfer status or duplicate approval.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Transfer not found.
 */
router.post(
  '/float-transfer/:id/approve',
  requireJwtAuth,
  validateParams(floatTransferIdParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  validateBody(emptyAgentBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const publicKey = (req as { user?: { publicKey?: string } }).user?.publicKey;
    const role = (req as { user?: { role?: string } }).user?.role;

    const result = await agentFloatService.approveTransfer({
      transferId: id,
      approver: publicKey!,
      userRole: role,
    });

    res.status(200).json({ success: true, data: result });
  }),
);

/**
 * @swagger
 * /agents/float-transfer/{id}/reject:
 *   post:
 *     summary: Reject a pending float transfer
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Float transfer rejected.
 *       400:
 *         description: Invalid transfer status.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Transfer not found.
 */
router.post(
  '/float-transfer/:id/reject',
  requireJwtAuth,
  validateParams(floatTransferIdParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  validateBody(emptyAgentBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const publicKey = (req as { user?: { publicKey?: string } }).user?.publicKey;
    const role = (req as { user?: { role?: string } }).user?.role;

    const result = await agentFloatService.rejectTransfer({
      transferId: id,
      rejector: publicKey!,
      userRole: role,
    });

    res.status(200).json({ success: true, data: { transfer: result } });
  }),
);

/**
 * @swagger
 * /agents/float-transfer/limits:
 *   get:
 *     summary: Get pair limits for an agent pair
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: fromAgent
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: toAgent
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pair limits retrieved.
 *       400:
 *         description: Invalid query parameters.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden.
 */
router.get(
  '/float-transfer/limits',
  requireJwtAuth,
  validateParams(emptyAgentParamsSchema),
  validateQuery(pairLimitsQuerySchema),
  validateBody(emptyAgentBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const fromAgent = req.query.fromAgent as string;
    const toAgent = req.query.toAgent as string;
    const publicKey = (req as { user?: { publicKey?: string } }).user?.publicKey;
    const role = (req as { user?: { role?: string } }).user?.role;

    if (role !== 'admin' && publicKey !== fromAgent && publicKey !== toAgent) {
      throw AppError.forbidden('Only the two agents in the pair or an admin can view these limits');
    }

    const result = await agentFloatService.getPairLimits(fromAgent, toAgent);

    res.status(200).json({ success: true, data: result });
  }),
);

/**
 * @swagger
 * /agents/float-transfer/limits:
 *   put:
 *     summary: Set or update pair limits (admin only)
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fromAgent, toAgent, dailyLimit, weeklyLimit]
 *             properties:
 *               fromAgent:
 *                 type: string
 *               toAgent:
 *                 type: string
 *               dailyLimit:
 *                 type: number
 *                 description: Daily limit in whole tokens (e.g. USDC), up to 7 decimal places
 *               weeklyLimit:
 *                 type: number
 *                 description: Weekly limit in whole tokens (e.g. USDC), up to 7 decimal places
 *     responses:
 *       200:
 *         description: Pair limits updated.
 *       400:
 *         description: Invalid request parameters.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Requires the admin role.
 */
router.put(
  '/float-transfer/limits',
  requireJwtAuth,
  requireRole('admin'),
  validateParams(emptyAgentParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  validateBody(setPairLimitsBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { fromAgent, toAgent, dailyLimit, weeklyLimit } = req.body;
    const publicKey = (req as { user?: { publicKey?: string } }).user?.publicKey;

    const result = await agentFloatService.setPairLimits({
      fromAgent,
      toAgent,
      dailyLimit,
      weeklyLimit,
      updatedBy: publicKey!,
    });

    res.status(200).json({ success: true, data: result });
  }),
);

export default router;
