import { Router } from 'express';
import {
  assignBorrower,
  getMyAssignments,
  removeBorrower,
} from '../controllers/agentController.js';
import { requireJwtAuth } from '../middleware/jwtAuth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditLog } from '../middleware/auditLog.js';
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
 *     summary: Build an agent registration transaction
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
 */
router.post('/register', requireJwtAuth, registerAgent);

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
router.get('/dashboard', requireJwtAuth, getAgentDashboard);

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
router.delete('/dashboard/cache', requireJwtAuth, clearAgentDashboardCache);

export default router;
