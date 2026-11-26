import { Router } from 'express';
import {
  assignBorrower,
  getMyAssignments,
  removeBorrower,
} from '../controllers/agentController.js';
import { requireJwtAuth } from '../middleware/jwtAuth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditLog } from '../middleware/auditLog.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';
import {
  agentPublicKeyParamsSchema,
  assignBorrowerBodySchema,
  emptyAgentBodySchema,
  emptyAgentParamsSchema,
  emptyAgentQuerySchema,
  removeBorrowerParamsSchema,
  agentApplicationBodySchema,
  agentApplicationIdParamsSchema,
  cashPickupRedeemBuildBodySchema,
  cashPickupRedeemConfirmBodySchema,
} from '../schemas/agentSchemas.js';
import {
  getAgentDashboard,
  clearAgentDashboardCache,
} from '../controllers/agentDashboardController.js';
import {
  registerAgent,
  activateAgent,
  topUpAgentBond,
  buildAgentVaultAction,
  getPublicSolvency,
  submitAgentTransaction,
  applyAsAgent,
  getMyAgentApplication,
  getPendingAgentApplications,
  buildApplicationRegistration,
  getMyAgentStatus,
  getAgentCashPickupClaims,
  buildCashPickupRedeemTx,
  confirmCashPickupRedeem,
} from '../controllers/agentMvpController.js';

const router = Router();

/**
 * @swagger
 * /agents/solvency:
 *   get:
 *     summary: Get the public solvency projection for active agents
 *     tags: [Agents]
 *     responses:
 *       200:
 *         description: Solvency projection
 */
router.get('/solvency', getPublicSolvency);

/**
 * @swagger
 * /agents/applications:
 *   post:
 *     summary: Submit an agent application
 *     tags: [Agents]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [kycRef, region, bond]
 *             properties:
 *               kycRef: { type: string, maxLength: 32 }
 *               region: { type: string, maxLength: 16 }
 *               bond: { type: string, description: Initial bond in whole tokens }
 *     responses:
 *       201: { description: Application submitted }
 *       409: { description: Application already exists }
 */
router.post(
  '/applications',
  requireJwtAuth,
  validateParams(emptyAgentParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  validateBody(agentApplicationBodySchema),
  applyAsAgent,
);

/**
 * @swagger
 * /agents/applications/me:
 *   get:
 *     summary: Get the authenticated wallet's application and registration transaction
 *     tags: [Agents]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Agent application or null }
 */
router.get(
  '/applications/me',
  requireJwtAuth,
  validateParams(emptyAgentParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  getMyAgentApplication,
);

/**
 * @swagger
 * /agents/applications/pending:
 *   get:
 *     summary: List agent applications for operator review
 *     tags: [Agents]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Agent applications with indexed status }
 *       403: { description: Configured operator required }
 */
router.get(
  '/applications/pending',
  requireJwtAuth,
  requireRole('admin'),
  validateParams(emptyAgentParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  getPendingAgentApplications,
);

/**
 * @swagger
 * /agents/applications/{applicationId}/register:
 *   post:
 *     summary: Build and persist an unsigned agent registration for the applicant
 *     tags: [Agents]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: applicationId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Unsigned transaction }
 *       403: { description: Configured operator required }
 */
router.post(
  '/applications/:applicationId/register',
  requireJwtAuth,
  requireRole('admin'),
  validateParams(agentApplicationIdParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  validateBody(emptyAgentBodySchema),
  buildApplicationRegistration,
);

/**
 * @swagger
 * /agents/status:
 *   get:
 *     summary: Get the authenticated wallet's indexed agent status
 *     tags: [Agents]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Indexed agent status or null }
 */
router.get(
  '/status',
  requireJwtAuth,
  validateParams(emptyAgentParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  getMyAgentStatus,
);
/**
 * @swagger
 * /agents/submit:
 *   post:
 *     summary: Submit a wallet-signed agent transaction
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [signedTxXdr]
 *             properties:
 *               signedTxXdr: { type: string }
 *     responses:
 *       200: { description: Transaction submitted }
 *       400: { description: Invalid transaction or failed submission }
 */
router.post('/submit', requireJwtAuth, submitAgentTransaction);

/**
 * @swagger
 * /agents/register:
 *   post:
 *     summary: Build an operator-approved agent registration transaction for the agent to sign
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [agentPublicKey, kycRef, region, bond, licenseExpiry]
 *             properties:
 *               agentPublicKey: { type: string }
 *               kycRef: { type: string, maxLength: 32 }
 *               region: { type: string, maxLength: 16 }
 *               bond: { type: string }
 *               licenseExpiry: { type: integer, format: int64 }
 *     responses:
 *       200: { description: Unsigned registration transaction }
 *       400: { description: Invalid registration data }
 *       403: { description: Configured operator required }
 */
router.post('/register', requireJwtAuth, requireRole('admin'), registerAgent);

/**
 * @swagger
 * /agents/{agentPublicKey}/activate:
 *   post:
 *     summary: Build an operator-signed activation transaction
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentPublicKey
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Unsigned activation transaction }
 *       403: { description: Configured operator required }
 */
router.post('/:agentPublicKey/activate', requireJwtAuth, requireRole('admin'), activateAgent);

/**
 * @swagger
 * /agents/{agentPublicKey}/top-up-bond:
 *   post:
 *     summary: Build an operator-signed bond top-up transaction
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentPublicKey
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: string }
 *     responses:
 *       200: { description: Unsigned bond top-up transaction }
 *       403: { description: Configured operator required }
 */
router.post('/:agentPublicKey/top-up-bond', requireJwtAuth, requireRole('admin'), topUpAgentBond);

/**
 * @swagger
 * /agents/vault/deposit-collateral:
 *   post:
 *     summary: Build a collateral deposit transaction
 *     tags: [Agents]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Unsigned transaction }
 */
router.post(
  '/vault/deposit-collateral',
  requireJwtAuth,
  requireRole('agent', 'admin'),
  buildAgentVaultAction('deposit_collateral'),
);

/**
 * @swagger
 * /agents/vault/withdraw-collateral:
 *   post:
 *     summary: Build a collateral withdrawal transaction
 *     tags: [Agents]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Unsigned transaction }
 */
router.post(
  '/vault/withdraw-collateral',
  requireJwtAuth,
  requireRole('agent', 'admin'),
  buildAgentVaultAction('withdraw_collateral'),
);

/**
 * @swagger
 * /agents/vault/mint-float:
 *   post:
 *     summary: Build an operator-signed cash-in transaction
 *     tags: [Agents]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Unsigned transaction }
 *       403: { description: Configured operator required }
 */
router.post(
  '/vault/mint-float',
  requireJwtAuth,
  requireRole('admin'),
  buildAgentVaultAction('mint_float'),
);

/**
 * @swagger
 * /agents/vault/burn-float:
 *   post:
 *     summary: Build a cash-out transaction
 *     tags: [Agents]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Unsigned transaction }
 */
router.post(
  '/vault/burn-float',
  requireJwtAuth,
  requireRole('agent', 'admin'),
  buildAgentVaultAction('burn_float'),
);

/**
 * @swagger
 * components:
 *   schemas:
 *     AgentDashboard:
 *       type: object
 *       properties:
 *         agentPublicKey:
 *           type: string
 *         floatUtilization:
 *           type: object
 *         earnings:
 *           type: object
 *         borrowerPortfolio:
 *           type: object
 *         pendingSettlements:
 *           type: object
 *         collateralRatio:
 *           type: object
 *         recentTransactions:
 *           type: array
 *           items:
 *             type: object
 */

/**
 * @swagger
 * /agents/my-assignments:
 *   get:
 *     summary: List borrower wallets assigned to the authenticated agent
 *     description: >
 *       Returns the borrowers the authenticated agent (or admin) is scoped to
 *       under tenant isolation (the `agents:view-assigned` scope). Agents can
 *       read but not modify the data of these borrowers on the loan, score and
 *       remittance endpoints, enforced both by the RBAC middleware and by RLS.
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Assignments retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, data]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   required: [agentPublicKey, assignments]
 *                   properties:
 *                     agentPublicKey:
 *                       type: string
 *                     assignments:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [borrowerPublicKey, createdAt]
 *                         properties:
 *                           borrowerPublicKey:
 *                             type: string
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: Requires the agent role.
 */
router.get(
  '/my-assignments',
  requireJwtAuth,
  requireRole('agent', 'lender', 'admin'),
  validateParams(emptyAgentParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  validateBody(emptyAgentBodySchema),
  getMyAssignments,
);

/**
 * @swagger
 * /agents/{agentPublicKey}/assignees:
 *   post:
 *     summary: Assign a borrower to an agent (admin only)
 *     description: >
 *       Grants an agent read access to a borrower's data. Idempotent: assigning
 *       the same pair twice returns the existing assignment. Admin only.
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentPublicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent's Stellar public key receiving the assignment
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [borrowerPublicKey]
 *             properties:
 *               borrowerPublicKey:
 *                 type: string
 *                 description: Borrower's Stellar public key to assign
 *     responses:
 *       201:
 *         description: Assignment created (or already present).
 *       400:
 *         description: Invalid public key.
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: Requires the admin role.
 */
router.post(
  '/:agentPublicKey/assignees',
  requireJwtAuth,
  requireRole('admin'),
  validateParams(agentPublicKeyParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  validateBody(assignBorrowerBodySchema),
  auditLog,
  assignBorrower,
);

/**
 * @swagger
 * /agents/{agentPublicKey}/assignees/{borrowerPublicKey}:
 *   delete:
 *     summary: Revoke a borrower assignment from an agent (admin only)
 *     description: >
 *       Removes the agent's read access to the borrower. Admin only.
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentPublicKey
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: borrowerPublicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Assignment revoked.
 *       400:
 *         description: Invalid public key.
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: Requires the admin role.
 *       404:
 *         description: Assignment not found.
 */
router.delete(
  '/:agentPublicKey/assignees/:borrowerPublicKey',
  requireJwtAuth,
  requireRole('admin'),
  validateParams(removeBorrowerParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  validateBody(emptyAgentBodySchema),
  auditLog,
  removeBorrower,
);

/**
 * @swagger
 * /agents/dashboard:
 *   get:
 *     summary: Get agent dashboard metrics
 *     tags: [Agent]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Agent dashboard data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentDashboard'
 */
router.get(
  '/dashboard',
  requireJwtAuth,
  validateParams(emptyAgentParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  validateBody(emptyAgentBodySchema),
  getAgentDashboard,
);

/**
 * @swagger
 * /agents/dashboard/cache:
 *   delete:
 *     summary: Clear agent dashboard cache
 *     tags: [Agent]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Cache cleared
 */
router.delete(
  '/dashboard/cache',
  requireJwtAuth,
  validateParams(emptyAgentParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  validateBody(emptyAgentBodySchema),
  clearAgentDashboardCache,
);

/**
 * @swagger
 * /agents/cash-pickup/claims:
 *   get:
 *     summary: List cash pickup claims assigned to the authenticated agent
 *     tags: [Agent]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Claims assigned to this agent (without one-time codes)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/CashPickupClaim' }
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/cash-pickup/claims',
  requireJwtAuth,
  validateParams(emptyAgentParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  getAgentCashPickupClaims,
);

/**
 * @swagger
 * /agents/cash-pickup/redeem:
 *   post:
 *     summary: Build the burn_float transaction to redeem a cash pickup claim
 *     description: >
 *       Checks the recipient's one-time code and returns an unsigned
 *       burn_float(agent, claim amount) transaction for the agent to sign.
 *     tags: [Agent]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [claimId, code]
 *             properties:
 *               claimId: { type: string, format: uuid }
 *               code: { type: string }
 *     responses:
 *       200:
 *         description: Unsigned burn_float transaction for the claim amount
 *       400:
 *         description: Invalid code, or the claim is not credited
 *       403:
 *         description: Not the assigned agent
 *       404:
 *         description: Claim not found
 *       409:
 *         description: Claim already redeemed
 */
router.post(
  '/cash-pickup/redeem',
  requireJwtAuth,
  validateParams(emptyAgentParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  validateBody(cashPickupRedeemBuildBodySchema),
  buildCashPickupRedeemTx,
);

/**
 * @swagger
 * /agents/cash-pickup/redeem/confirm:
 *   post:
 *     summary: Submit the signed burn_float and mark the claim redeemed
 *     description: >
 *       The signed transaction must be exactly burn_float(agent, claim amount)
 *       on the agent vault. The claim becomes redeemed only after it confirms.
 *     tags: [Agent]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [claimId, code, signedTxXdr]
 *             properties:
 *               claimId: { type: string, format: uuid }
 *               code: { type: string }
 *               signedTxXdr: { type: string }
 *     responses:
 *       200:
 *         description: Claim redeemed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/CashPickupClaim' }
 *       400:
 *         description: Invalid code, or the signed transaction is not the expected burn_float
 *       403:
 *         description: Not the assigned agent
 *       409:
 *         description: Claim already redeemed
 */
router.post(
  '/cash-pickup/redeem/confirm',
  requireJwtAuth,
  validateParams(emptyAgentParamsSchema),
  validateQuery(emptyAgentQuerySchema),
  validateBody(cashPickupRedeemConfirmBodySchema),
  confirmCashPickupRedeem,
);

export default router;
