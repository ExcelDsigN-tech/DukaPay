/**
 * @swagger
 * /admin/audit-logs:
 *   get:
 *     summary: Get audit logs
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: actor
 *         schema:
 *           type: string
 *           maxLength: 255
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           maxLength: 255
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 25
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 10000
 *           default: 0
 *       - in: query
 *         name: withTotal
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Audit logs retrieved successfully
 */
